/**
 * Mapping tables from external diagram tool shape identifiers to Viridian serviceId / groupTypeId.
 */

// ─── draw.io mxgraph.aws4.* → Viridian serviceId ────────────────────────────
// Keys are the shape suffix after "mxgraph.aws4." (lowercase).
// Covers both direct shape references and resIcon/prIcon values.

export const DRAWIO_SERVICE_MAP: Record<string, string> = {
  // Compute
  ec2: 'ec2',
  ec2_instance: 'ec2',
  instance: 'ec2',
  instance2: 'ec2',
  instances: 'ec2',
  lambda: 'lambda',
  lambda_function: 'lambda',
  ecs: 'ecs',
  eks: 'eks',
  fargate: 'fargate',
  lightsail: 'lightsail',
  elastic_beanstalk: 'elastic-beanstalk',
  beanstalk: 'elastic-beanstalk',

  // Storage
  s3: 's3',
  bucket: 's3',
  bucket_with_objects: 's3',
  simple_storage_service: 's3',
  simple_storage_service_s3: 's3',
  ebs: 'ebs',
  elastic_block_store: 'ebs',
  efs: 'efs',
  elastic_file_system: 'efs',
  glacier: 'glacier',
  s3_glacier: 'glacier',
  simple_storage_service_glacier: 'glacier',

  // Database
  rds: 'rds',
  rds_instance: 'rds',
  dynamodb: 'dynamodb',
  dynamodb_table: 'dynamodb',
  aurora: 'aurora',
  elasticache: 'elasticache',
  elasti_cache: 'elasticache',
  redshift: 'redshift',
  documentdb: 'documentdb',
  documentdb_with_mongodb_compatibility: 'documentdb',

  // Networking
  vpc: 'vpc',
  virtual_private_cloud: 'vpc',
  cloudfront: 'cloudfront',
  cloud_front: 'cloudfront',
  route_53: 'route53',
  route53: 'route53',
  elb: 'elb',
  elastic_load_balancing: 'elb',
  application_load_balancer: 'elb',
  network_load_balancer: 'elb',
  classic_load_balancer: 'elb',
  api_gateway: 'api-gateway',
  apigateway: 'api-gateway',
  direct_connect: 'direct-connect',
  transit_gateway: 'transit-gateway',

  // Security
  iam: 'iam',
  identity_and_access_management: 'iam',
  cognito: 'cognito',
  waf: 'waf',
  kms: 'kms',
  key_management_service: 'kms',
  secrets_manager: 'secrets-manager',

  // AI/ML
  sagemaker: 'sagemaker',
  bedrock: 'bedrock',
  rekognition: 'rekognition',

  // Analytics
  kinesis: 'kinesis',
  kinesis_data_streams: 'kinesis',
  kinesis_data_firehose: 'kinesis',
  athena: 'athena',
  glue: 'glue',
  opensearch: 'opensearch',
  opensearch_service: 'opensearch',
  elasticsearch_service: 'opensearch',

  // Management
  cloudwatch: 'cloudwatch',
  cloud_watch: 'cloudwatch',
  cloudformation: 'cloudformation',
  cloud_formation: 'cloudformation',
  cloudtrail: 'cloudtrail',
  cloud_trail: 'cloudtrail',
  systems_manager: 'systems-manager',
  ssm: 'systems-manager',

  // Integration
  sqs: 'sqs',
  simple_queue_service: 'sqs',
  sns: 'sns',
  simple_notification_service: 'sns',
  step_functions: 'step-functions',
  eventbridge: 'eventbridge',
  event_bridge: 'eventbridge',
  mq: 'mq',
  amazon_mq: 'mq',

  // Developer Tools
  codepipeline: 'codepipeline',
  code_pipeline: 'codepipeline',
  codecommit: 'codecommit',
  code_commit: 'codecommit',
  codebuild: 'codebuild',
  code_build: 'codebuild',
  cdk: 'cdk',
  cloud_development_kit: 'cdk',
};

// ─── draw.io group icon → Viridian groupTypeId ──────────────────────────────
// Keys are the suffix after "mxgraph.aws4.group_" (lowercase).

export const DRAWIO_GROUP_MAP: Record<string, string> = {
  region: 'region',
  aws_cloud: 'account',
  aws_cloud_alt: 'account',
  corporate_data_center: 'generic',
  vpc: 'vpc',
  vpc2: 'vpc',
  availability_zone: 'availability-zone',
  security_group: 'security-group',
  auto_scaling: 'auto-scaling',
  auto_scaling_group: 'auto-scaling',
  aws_account: 'account',
  private_subnet: 'subnet-private',
  public_subnet: 'subnet-public',
  generic: 'generic',
};

// ─── Lucid.app shape name → Viridian serviceId ──────────────────────────────
// Keys are lowercased display names from the Lucid CSV "Name" column.
// The Shape Library column should contain "AWS" to trigger this lookup.

export const LUCID_SERVICE_MAP: Record<string, string> = {
  // Compute
  'amazon ec2': 'ec2',
  ec2: 'ec2',
  'aws lambda': 'lambda',
  lambda: 'lambda',
  'amazon ecs': 'ecs',
  'amazon elastic container service': 'ecs',
  'amazon eks': 'eks',
  'amazon elastic kubernetes service': 'eks',
  'aws fargate': 'fargate',
  fargate: 'fargate',
  'amazon lightsail': 'lightsail',
  lightsail: 'lightsail',
  'aws elastic beanstalk': 'elastic-beanstalk',
  'elastic beanstalk': 'elastic-beanstalk',

  // Storage
  'amazon s3': 's3',
  s3: 's3',
  'simple storage service': 's3',
  'amazon ebs': 'ebs',
  'elastic block store': 'ebs',
  'amazon efs': 'efs',
  'elastic file system': 'efs',
  'amazon s3 glacier': 'glacier',
  glacier: 'glacier',

  // Database
  'amazon rds': 'rds',
  rds: 'rds',
  'amazon dynamodb': 'dynamodb',
  dynamodb: 'dynamodb',
  'amazon aurora': 'aurora',
  aurora: 'aurora',
  'amazon elasticache': 'elasticache',
  elasticache: 'elasticache',
  'amazon redshift': 'redshift',
  redshift: 'redshift',
  'amazon documentdb': 'documentdb',
  documentdb: 'documentdb',

  // Networking
  'amazon vpc': 'vpc',
  vpc: 'vpc',
  'amazon cloudfront': 'cloudfront',
  cloudfront: 'cloudfront',
  'amazon route 53': 'route53',
  'route 53': 'route53',
  'elastic load balancing': 'elb',
  elb: 'elb',
  'amazon api gateway': 'api-gateway',
  'api gateway': 'api-gateway',
  'aws direct connect': 'direct-connect',
  'direct connect': 'direct-connect',
  'aws transit gateway': 'transit-gateway',
  'transit gateway': 'transit-gateway',

  // Security
  'aws iam': 'iam',
  iam: 'iam',
  'identity and access management': 'iam',
  'amazon cognito': 'cognito',
  cognito: 'cognito',
  'aws waf': 'waf',
  waf: 'waf',
  'aws kms': 'kms',
  kms: 'kms',
  'aws secrets manager': 'secrets-manager',
  'secrets manager': 'secrets-manager',

  // AI/ML
  'amazon sagemaker': 'sagemaker',
  sagemaker: 'sagemaker',
  'amazon bedrock': 'bedrock',
  bedrock: 'bedrock',
  'amazon rekognition': 'rekognition',
  rekognition: 'rekognition',

  // Analytics
  'amazon kinesis': 'kinesis',
  kinesis: 'kinesis',
  'amazon athena': 'athena',
  athena: 'athena',
  'aws glue': 'glue',
  glue: 'glue',
  'amazon opensearch': 'opensearch',
  'amazon opensearch service': 'opensearch',

  // Management
  'amazon cloudwatch': 'cloudwatch',
  cloudwatch: 'cloudwatch',
  'aws cloudformation': 'cloudformation',
  cloudformation: 'cloudformation',
  'aws cloudtrail': 'cloudtrail',
  cloudtrail: 'cloudtrail',
  'aws systems manager': 'systems-manager',
  'systems manager': 'systems-manager',

  // Integration
  'amazon sqs': 'sqs',
  sqs: 'sqs',
  'amazon sns': 'sns',
  sns: 'sns',
  'aws step functions': 'step-functions',
  'step functions': 'step-functions',
  'amazon eventbridge': 'eventbridge',
  eventbridge: 'eventbridge',
  'amazon mq': 'mq',

  // Developer Tools
  'aws codepipeline': 'codepipeline',
  codepipeline: 'codepipeline',
  'aws codecommit': 'codecommit',
  codecommit: 'codecommit',
  'aws codebuild': 'codebuild',
  codebuild: 'codebuild',
  'aws cdk': 'cdk',
  cdk: 'cdk',
  'aws cloud development kit (aws cdk)': 'cdk',
  'aws cloud development kit': 'cdk',
  'cloud development kit (aws cdk)': 'cdk',
  'cloud development kit': 'cdk',

  // Full/verbose names with parenthetical aliases (Lucid CSV uses these)
  'amazon simple queue service': 'sqs',
  'simple queue service': 'sqs',
  'amazon simple storage service (amazon s3)': 's3',
  'amazon simple storage service': 's3',
  'amazon simple notification service (amazon sns)': 'sns',
  'amazon simple notification service': 'sns',
  'aws identity and access management (iam)': 'iam',
  'identity and access management (iam)': 'iam',
  'aws key management service': 'kms',
  'key management service': 'kms',

  // Networking variants
  'application load balancer': 'elb',
  'network load balancer': 'elb',
  'classic load balancer': 'elb',

  // Container service shapes
  'ecs fargate container': 'fargate',
  'ecs container 1': 'ecs',
  'ecs container': 'ecs',

  // Integration variants
  'aws step functions workflow': 'step-functions',
  'step functions workflow': 'step-functions',

  // Security (newer services)
  'amazon verified permissions': 'verified-permissions',
  'verified permissions': 'verified-permissions',

  // Third-party / non-AWS shapes mapped to closest AWS equivalent
  'oracle database': 'rds',
  'oracle db': 'rds',
  'table': 'rds',          // Lucid AWS "Table" shape (DB table rows)
  'api': 'api-gateway',    // Google Cloud "API" shape used for external APIs
  'terminal': 'api-gateway', // Network Infrastructure "Terminal" used as WebService
};

// ─── Lucid group name → Viridian groupTypeId ────────────────────────────────

export const LUCID_GROUP_MAP: Record<string, string> = {
  region: 'region',
  'aws region': 'region',
  vpc: 'vpc',
  'amazon vpc': 'vpc',
  'availability zone': 'availability-zone',
  'public subnet': 'subnet-public',
  'private subnet': 'subnet-private',
  'security group': 'security-group',
  'network security group': 'security-group',
  'auto scaling group': 'auto-scaling',
  'auto scaling': 'auto-scaling',
  'aws account': 'account',
  'aws cloud': 'account',
  'amazon cloud': 'account',
  account: 'account',
  // Generic containers from various Lucid libraries
  'ecs fargate container': 'generic',
  'corporate data center': 'generic',
  'server contents': 'generic',
  'aws step functions workflow': 'generic',
  'generic group': 'generic',
  'rectangle container': 'generic',
};

// ─── Fuzzy matching helper ──────────────────────────────────────────────────

/**
 * Try to match a shape name to a Viridian serviceId using fuzzy matching.
 * Strips common prefixes like "Amazon", "AWS", normalizes whitespace, etc.
 */
export function fuzzyMatchService(name: string, map: Record<string, string>): string | null {
  const normalized = name.toLowerCase().trim();

  // Direct match
  if (map[normalized]) return map[normalized];

  // Strip common prefixes
  for (const prefix of ['amazon ', 'aws ', 'aws::']) {
    if (normalized.startsWith(prefix)) {
      const stripped = normalized.slice(prefix.length).trim();
      if (map[stripped]) return map[stripped];
    }
  }

  // Try matching by just the last word (e.g., "Lambda" from "AWS Lambda Function")
  const words = normalized.split(/\s+/);
  const lastWord = words[words.length - 1] ?? '';
  if (lastWord && map[lastWord]) return map[lastWord];

  return null;
}
