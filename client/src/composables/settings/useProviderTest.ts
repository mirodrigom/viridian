import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';

export interface TestResult {
  label: string;
  envVarName: string;
  modelId?: string;  // set when this row represents an individual model test
  status: 'pending' | 'running' | 'success' | 'error' | 'unconfigured';
  message: string;
}

export interface ProviderTestDeps {
  getSetup: () => { envVarOptions?: Array<{ label: string; name: string }>; envVar?: { name: string } } | null;
}

export function useProviderTest(deps: ProviderTestDeps) {
  const testResults = ref<TestResult[]>([]);
  const testing = ref(false);
  const showResults = computed(() => testResults.value.length > 0);

  // Tracks last test outcome per envVarName: 'ok' | 'error' | 'untested'
  const keyStatuses = ref<Record<string, 'ok' | 'error' | 'untested'>>({});

  async function runTests(
    providerId: string,
    providerName: string,
  ): Promise<{ anySuccess: boolean; failedModelIds: string[] }> {
    const setup = deps.getSetup();
    const backends: Array<{ label: string; envVarName?: string }> = [];
    if (setup?.envVarOptions) {
      for (const opt of setup.envVarOptions) {
        backends.push({ label: opt.label, envVarName: opt.name });
      }
    } else {
      backends.push({ label: providerName });
    }

    testResults.value = backends.map(b => ({
      label: b.label,
      envVarName: b.envVarName ?? '',
      status: 'pending' as const,
      message: '',
    }));

    testing.value = true;
    let anySuccess = false;
    const failedModelIds: string[] = [];
    let rowIdx = 0;

    for (const backend of backends) {
      testResults.value[rowIdx]!.status = 'running';
      const testBody: Record<string, string> = {};
      if (backend.envVarName) testBody.envVarName = backend.envVarName;

      try {
        const testRes = await apiFetch(`/api/providers/${providerId}/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testBody),
        });
        const testData = await testRes.json() as {
          success: boolean;
          message: string;
          models?: Array<{ id: string; label: string; success: boolean; message: string }>;
        };

        const envVarName = backend.envVarName ?? '';
        const isUnconfigured = !testData.success && /no api key/i.test(testData.message);
        const modelList = testData.models ?? [];

        if (modelList.length > 1) {
          // Per-model results (e.g. Gemini) — expand this placeholder row into one row per model
          const modelRows: TestResult[] = modelList.map(m => ({
            label: m.label,
            envVarName,
            modelId: m.id,
            status: (isUnconfigured ? 'unconfigured' : m.success ? 'success' : 'error') as TestResult['status'],
            message: m.message,
          }));
          testResults.value.splice(rowIdx, 1, ...modelRows);
          rowIdx += modelList.length;
          for (const m of modelList) {
            if (!m.success && !isUnconfigured) failedModelIds.push(m.id);
          }
        } else {
          // Single result (connection test or no models list)
          testResults.value[rowIdx]!.status = isUnconfigured ? 'unconfigured' : testData.success ? 'success' : 'error';
          testResults.value[rowIdx]!.message = modelList[0]?.message ?? testData.message;
          rowIdx++;
        }

        // Update key badge status: envVar is set for multi-backend; fall back to setup.envVar for single
        const envVar = envVarName || setup?.envVar?.name || '';
        if (!isUnconfigured && envVar) {
          keyStatuses.value[envVar] = testData.success ? 'ok' : 'error';
        }
        if (testData.success) anySuccess = true;
      } catch (err) {
        testResults.value[rowIdx]!.status = 'error';
        testResults.value[rowIdx]!.message = err instanceof Error ? err.message : 'Request failed';
        const envVar = backend.envVarName || setup?.envVar?.name || '';
        if (envVar) keyStatuses.value[envVar] = 'error';
        rowIdx++;
      }
    }

    testing.value = false;
    return { anySuccess, failedModelIds };
  }

  function clearResults() {
    testResults.value = [];
  }

  function resetKeyStatuses() {
    keyStatuses.value = {};
  }

  return {
    testResults,
    testing,
    showResults,
    keyStatuses,
    runTests,
    clearResults,
    resetKeyStatuses,
  };
}
