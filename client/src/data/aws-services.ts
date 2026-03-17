// AWS Service catalog for the Diagram Manager
// Uses official AWS Architecture Icons from the aws-icons package

// ── Icon imports (official AWS Architecture Icons) ─────────────────────────
import iconEC2 from 'aws-icons/icons/architecture-service/AmazonEC2.svg';
import iconLambda from 'aws-icons/icons/architecture-service/AWSLambda.svg';
import iconECS from 'aws-icons/icons/architecture-service/AmazonElasticContainerService.svg';
import iconEKS from 'aws-icons/icons/architecture-service/AmazonElasticKubernetesService.svg';
import iconFargate from 'aws-icons/icons/architecture-service/AWSFargate.svg';
import iconLightsail from 'aws-icons/icons/architecture-service/AmazonLightsail.svg';
import iconBeanstalk from 'aws-icons/icons/architecture-service/AWSElasticBeanstalk.svg';
import iconS3 from 'aws-icons/icons/architecture-service/AmazonSimpleStorageService.svg';
import iconEBS from 'aws-icons/icons/architecture-service/AmazonElasticBlockStore.svg';
import iconEFS from 'aws-icons/icons/architecture-service/AmazonEFS.svg';
import iconGlacier from 'aws-icons/icons/architecture-service/AmazonSimpleStorageServiceGlacier.svg';
import iconRDS from 'aws-icons/icons/architecture-service/AmazonRDS.svg';
import iconDynamoDB from 'aws-icons/icons/architecture-service/AmazonDynamoDB.svg';
import iconAurora from 'aws-icons/icons/architecture-service/AmazonAurora.svg';
import iconElastiCache from 'aws-icons/icons/architecture-service/AmazonElastiCache.svg';
import iconRedshift from 'aws-icons/icons/architecture-service/AmazonRedshift.svg';
import iconDocumentDB from 'aws-icons/icons/architecture-service/AmazonDocumentDB.svg';
import iconVPC from 'aws-icons/icons/architecture-service/AmazonVirtualPrivateCloud.svg';
import iconCloudFront from 'aws-icons/icons/architecture-service/AmazonCloudFront.svg';
import iconRoute53 from 'aws-icons/icons/architecture-service/AmazonRoute53.svg';
import iconELB from 'aws-icons/icons/architecture-service/ElasticLoadBalancing.svg';
import iconAPIGateway from 'aws-icons/icons/architecture-service/AmazonAPIGateway.svg';
import iconDirectConnect from 'aws-icons/icons/architecture-service/AWSDirectConnect.svg';
import iconTransitGateway from 'aws-icons/icons/architecture-service/AWSTransitGateway.svg';
import iconIAM from 'aws-icons/icons/architecture-service/AWSIdentityandAccessManagement.svg';
import iconCognito from 'aws-icons/icons/architecture-service/AmazonCognito.svg';
import iconWAF from 'aws-icons/icons/architecture-service/AWSWAF.svg';
import iconKMS from 'aws-icons/icons/architecture-service/AWSKeyManagementService.svg';
import iconSecretsManager from 'aws-icons/icons/architecture-service/AWSSecretsManager.svg';
import iconSageMaker from 'aws-icons/icons/architecture-service/AmazonSageMaker.svg';
import iconBedrock from 'aws-icons/icons/architecture-service/AmazonBedrock.svg';
import iconRekognition from 'aws-icons/icons/architecture-service/AmazonRekognition.svg';
import iconKinesis from 'aws-icons/icons/architecture-service/AmazonKinesis.svg';
import iconAthena from 'aws-icons/icons/architecture-service/AmazonAthena.svg';
import iconGlue from 'aws-icons/icons/architecture-service/AWSGlue.svg';
import iconOpenSearch from 'aws-icons/icons/architecture-service/AmazonOpenSearchService.svg';
import iconCloudWatch from 'aws-icons/icons/architecture-service/AmazonCloudWatch.svg';
import iconCloudFormation from 'aws-icons/icons/architecture-service/AWSCloudFormation.svg';
import iconCloudTrail from 'aws-icons/icons/architecture-service/AWSCloudTrail.svg';
import iconSystemsManager from 'aws-icons/icons/architecture-service/AWSSystemsManager.svg';
import iconSQS from 'aws-icons/icons/architecture-service/AmazonSimpleQueueService.svg';
import iconSNS from 'aws-icons/icons/architecture-service/AmazonSimpleNotificationService.svg';
import iconStepFunctions from 'aws-icons/icons/architecture-service/AWSStepFunctions.svg';
import iconEventBridge from 'aws-icons/icons/architecture-service/AmazonEventBridge.svg';
import iconMQ from 'aws-icons/icons/architecture-service/AmazonMQ.svg';
import iconCodePipeline from 'aws-icons/icons/architecture-service/AWSCodePipeline.svg';
import iconCodeCommit from 'aws-icons/icons/architecture-service/AWSCodeCommit.svg';
import iconCodeBuild from 'aws-icons/icons/architecture-service/AWSCodeBuild.svg';
import iconCDK from 'aws-icons/icons/architecture-service/AWSCloudDevelopmentKit.svg';
import iconVerifiedPermissions from 'aws-icons/icons/architecture-service/AmazonVerifiedPermissions.svg';

export type AWSCategory =
  | 'Compute'
  | 'Storage'
  | 'Database'
  | 'Networking'
  | 'Security'
  | 'AI/ML'
  | 'Analytics'
  | 'Management'
  | 'Integration'
  | 'Developer Tools'
  | 'Containers';

export interface AWSService {
  id: string;
  name: string;
  shortName: string;
  category: AWSCategory;
  /** SVG path data for the icon (24x24 viewBox) — fallback */
  iconPath: string;
  /** URL to official AWS Architecture Icon SVG */
  iconUrl: string;
  description: string;
  color: string;
}

export interface AWSGroupType {
  id: string;
  name: string;
  color: string;
  borderStyle: 'dashed' | 'solid';
  description: string;
}

export const AWS_CATEGORIES: { id: AWSCategory; color: string; iconPath: string }[] = [
  { id: 'Compute', color: '#FF9900', iconPath: 'M13 2L3 14h4l-1 8 10-12h-4l1-8z' },
  { id: 'Storage', color: '#3F8624', iconPath: 'M4 4h16v4H4V4zm0 6h16v4H4v-4zm0 6h16v4H4v-4z' },
  { id: 'Database', color: '#C925D1', iconPath: 'M12 2C6.48 2 2 4.24 2 7v10c0 2.76 4.48 5 10 5s10-2.24 10-5V7c0-2.76-4.48-5-10-5z' },
  { id: 'Networking', color: '#8C4FFF', iconPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'Security', color: '#DD344C', iconPath: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z' },
  { id: 'AI/ML', color: '#01A88D', iconPath: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a2 2 0 110 4 2 2 0 010-4zm-4 8a2 2 0 110 4 2 2 0 010-4zm8 0a2 2 0 110 4 2 2 0 010-4z' },
  { id: 'Analytics', color: '#8C4FFF', iconPath: 'M3 3v18h18M7 16l4-4 4 4 5-6' },
  { id: 'Management', color: '#E7157B', iconPath: 'M12 15.5A3.5 3.5 0 0115.5 12 3.5 3.5 0 0112 8.5 3.5 3.5 0 018.5 12 3.5 3.5 0 0112 15.5zM19.43 12.97c.04-.32.07-.64.07-.97s-.03-.66-.07-.97l2.11-1.65a.5.5 0 00.12-.64l-2-3.46a.5.5 0 00-.61-.22l-2.49 1a7.3 7.3 0 00-1.67-.97l-.38-2.65A.49.49 0 0014 2h-4a.49.49 0 00-.49.42l-.38 2.65c-.61.25-1.17.59-1.67.97l-2.49-1a.49.49 0 00-.61.22l-2 3.46a.49.49 0 00.12.64l2.11 1.65' },
  { id: 'Integration', color: '#E7157B', iconPath: 'M4 12h4l3-9 4 18 3-9h4' },
  { id: 'Developer Tools', color: '#C925D1', iconPath: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
  { id: 'Containers', color: '#FF9900', iconPath: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
];

export const AWS_GROUP_TYPES: AWSGroupType[] = [
  { id: 'region', name: 'Region', color: '#147EBA', borderStyle: 'dashed', description: 'AWS Region boundary' },
  { id: 'vpc', name: 'VPC', color: '#3F8624', borderStyle: 'solid', description: 'Virtual Private Cloud' },
  { id: 'availability-zone', name: 'Availability Zone', color: '#147EBA', borderStyle: 'dashed', description: 'Availability Zone boundary' },
  { id: 'subnet-public', name: 'Public Subnet', color: '#3F8624', borderStyle: 'dashed', description: 'Public subnet' },
  { id: 'subnet-private', name: 'Private Subnet', color: '#147EBA', borderStyle: 'dashed', description: 'Private subnet' },
  { id: 'security-group', name: 'Security Group', color: '#DD344C', borderStyle: 'dashed', description: 'Security group boundary' },
  { id: 'auto-scaling', name: 'Auto Scaling Group', color: '#FF9900', borderStyle: 'dashed', description: 'Auto Scaling group' },
  { id: 'account', name: 'AWS Account', color: '#232F3E', borderStyle: 'solid', description: 'AWS Account boundary' },
  { id: 'generic', name: 'Generic Group', color: '#8C8C8C', borderStyle: 'dashed', description: 'Generic grouping container' },
];

export const AWS_SERVICES: AWSService[] = [
  // ── Compute ────────────────────────────────────────────────────────
  {
    id: 'ec2', name: 'Amazon EC2', shortName: 'EC2', category: 'Compute',
    color: '#FF9900', description: 'Virtual servers in the cloud',
    iconPath: 'M4 4h16v16H4V4zm4 4h8v8H8V8z', iconUrl: iconEC2,
  },
  {
    id: 'lambda', name: 'AWS Lambda', shortName: 'Lambda', category: 'Compute',
    color: '#FF9900', description: 'Serverless compute service',
    iconPath: 'M6 20l6-16 6 16H6zm6-12l-3 8h6l-3-8z', iconUrl: iconLambda,
  },
  {
    id: 'ecs', name: 'Amazon ECS', shortName: 'ECS', category: 'Containers',
    color: '#FF9900', description: 'Container orchestration service',
    iconPath: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zm-10 10h8v8H3v-8zm10 0h8v8h-8v-8z', iconUrl: iconECS,
  },
  {
    id: 'eks', name: 'Amazon EKS', shortName: 'EKS', category: 'Containers',
    color: '#FF9900', description: 'Managed Kubernetes service',
    iconPath: 'M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zm0 4L8 8.5v5L12 16l4-2.5v-5L12 6z', iconUrl: iconEKS,
  },
  {
    id: 'fargate', name: 'AWS Fargate', shortName: 'Fargate', category: 'Containers',
    color: '#FF9900', description: 'Serverless compute for containers',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 5l5 3v6l-5 3-5-3V10l5-3z', iconUrl: iconFargate,
  },
  {
    id: 'lightsail', name: 'Amazon Lightsail', shortName: 'Lightsail', category: 'Compute',
    color: '#FF9900', description: 'Simple virtual private servers',
    iconPath: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 3a7 7 0 110 14 7 7 0 010-14z', iconUrl: iconLightsail,
  },
  {
    id: 'elastic-beanstalk', name: 'AWS Elastic Beanstalk', shortName: 'Beanstalk', category: 'Compute',
    color: '#FF9900', description: 'Easy-to-use service for deploying applications',
    iconPath: 'M12 2v4m0 12v4M6 12H2m20 0h-4m-1.5-6.5L18 4m-12 0 1.5 1.5m0 13L6 20m12 0-1.5-1.5M12 8a4 4 0 100 8 4 4 0 000-8z', iconUrl: iconBeanstalk,
  },

  // ── Storage ────────────────────────────────────────────────────────
  {
    id: 's3', name: 'Amazon S3', shortName: 'S3', category: 'Storage',
    color: '#3F8624', description: 'Object storage service',
    iconPath: 'M2 12c0-3 4.5-5 10-5s10 2 10 5-4.5 5-10 5S2 15 2 12zm0-5c0-3 4.5-5 10-5s10 2 10 5M2 7v10m20-10v10', iconUrl: iconS3,
  },
  {
    id: 'ebs', name: 'Amazon EBS', shortName: 'EBS', category: 'Storage',
    color: '#3F8624', description: 'Block storage for EC2',
    iconPath: 'M4 4h12l4 4v12H4V4zm12 0v4h4', iconUrl: iconEBS,
  },
  {
    id: 'efs', name: 'Amazon EFS', shortName: 'EFS', category: 'Storage',
    color: '#3F8624', description: 'Elastic file system',
    iconPath: 'M3 4h18v4H3V4zm0 6h12v4H3v-4zm0 6h18v4H3v-4z', iconUrl: iconEFS,
  },
  {
    id: 'glacier', name: 'Amazon S3 Glacier', shortName: 'Glacier', category: 'Storage',
    color: '#3F8624', description: 'Low-cost archive storage',
    iconPath: 'M12 2l10 20H2L12 2zm0 6l-5 10h10L12 8z', iconUrl: iconGlacier,
  },

  // ── Database ───────────────────────────────────────────────────────
  {
    id: 'rds', name: 'Amazon RDS', shortName: 'RDS', category: 'Database',
    color: '#C925D1', description: 'Managed relational database service',
    iconPath: 'M12 2C7 2 3 3.8 3 6v12c0 2.2 4 4 9 4s9-1.8 9-4V6c0-2.2-4-4-9-4zm0 4c5 0 9-1.8 9-4M3 6c0 2.2 4 4 9 4s9-1.8 9-4M3 12c0 2.2 4 4 9 4s9-1.8 9-4', iconUrl: iconRDS,
  },
  {
    id: 'dynamodb', name: 'Amazon DynamoDB', shortName: 'DynamoDB', category: 'Database',
    color: '#C925D1', description: 'Managed NoSQL database service',
    iconPath: 'M12 2l-8 4v12l8 4 8-4V6l-8-4zm0 8l-8-4m8 4l8-4m-8 4v10', iconUrl: iconDynamoDB,
  },
  {
    id: 'aurora', name: 'Amazon Aurora', shortName: 'Aurora', category: 'Database',
    color: '#C925D1', description: 'MySQL and PostgreSQL-compatible relational database',
    iconPath: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 4a6 6 0 110 12 6 6 0 010-12zm0 2a4 4 0 100 8 4 4 0 000-8z', iconUrl: iconAurora,
  },
  {
    id: 'elasticache', name: 'Amazon ElastiCache', shortName: 'ElastiCache', category: 'Database',
    color: '#C925D1', description: 'In-memory caching service',
    iconPath: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 4l6 3v6l-6 3-6-3V9l6-3z', iconUrl: iconElastiCache,
  },
  {
    id: 'redshift', name: 'Amazon Redshift', shortName: 'Redshift', category: 'Database',
    color: '#C925D1', description: 'Data warehousing service',
    iconPath: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-2 5h4v3h3l-5 5-5-5h3V7z', iconUrl: iconRedshift,
  },
  {
    id: 'documentdb', name: 'Amazon DocumentDB', shortName: 'DocumentDB', category: 'Database',
    color: '#C925D1', description: 'MongoDB-compatible document database',
    iconPath: 'M6 2h12v20H6V2zm3 4h6m-6 4h6m-6 4h4', iconUrl: iconDocumentDB,
  },

  // ── Networking ─────────────────────────────────────────────────────
  {
    id: 'vpc', name: 'Amazon VPC', shortName: 'VPC', category: 'Networking',
    color: '#8C4FFF', description: 'Isolated cloud resources',
    iconPath: 'M4 4h16v16H4V4zm2 2v12h12V6H6z', iconUrl: iconVPC,
  },
  {
    id: 'cloudfront', name: 'Amazon CloudFront', shortName: 'CloudFront', category: 'Networking',
    color: '#8C4FFF', description: 'Content delivery network',
    iconPath: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 017 7h-3a4 4 0 00-8 0H5a7 7 0 017-7z', iconUrl: iconCloudFront,
  },
  {
    id: 'route53', name: 'Amazon Route 53', shortName: 'Route 53', category: 'Networking',
    color: '#8C4FFF', description: 'Scalable DNS service',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z', iconUrl: iconRoute53,
  },
  {
    id: 'elb', name: 'Elastic Load Balancing', shortName: 'ELB', category: 'Networking',
    color: '#8C4FFF', description: 'Distribute traffic across targets',
    iconPath: 'M12 2v4m0 12v4M4 12h3m10 0h3M12 6a6 6 0 110 12 6 6 0 010-12zm0 3a3 3 0 100 6 3 3 0 000-6z', iconUrl: iconELB,
  },
  {
    id: 'api-gateway', name: 'Amazon API Gateway', shortName: 'API GW', category: 'Networking',
    color: '#8C4FFF', description: 'Create, publish, and manage APIs',
    iconPath: 'M4 6h16v12H4V6zm4 3v6m4-6v6m4-6v6', iconUrl: iconAPIGateway,
  },
  {
    id: 'direct-connect', name: 'AWS Direct Connect', shortName: 'Direct Connect', category: 'Networking',
    color: '#8C4FFF', description: 'Dedicated network connection to AWS',
    iconPath: 'M2 12h6m8 0h6M8 8v8m8-8v8M8 12h8', iconUrl: iconDirectConnect,
  },
  {
    id: 'transit-gateway', name: 'AWS Transit Gateway', shortName: 'Transit GW', category: 'Networking',
    color: '#8C4FFF', description: 'Connect VPCs and on-premises networks',
    iconPath: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 5v10M7 12h10', iconUrl: iconTransitGateway,
  },

  // ── Security ───────────────────────────────────────────────────────
  {
    id: 'iam', name: 'AWS IAM', shortName: 'IAM', category: 'Security',
    color: '#DD344C', description: 'Identity and access management',
    iconPath: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm-4.5 9c0-2.5 3-3.5 4.5-3.5s4.5 1 4.5 3.5', iconUrl: iconIAM,
  },
  {
    id: 'cognito', name: 'Amazon Cognito', shortName: 'Cognito', category: 'Security',
    color: '#DD344C', description: 'User identity and authentication',
    iconPath: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z', iconUrl: iconCognito,
  },
  {
    id: 'waf', name: 'AWS WAF', shortName: 'WAF', category: 'Security',
    color: '#DD344C', description: 'Web application firewall',
    iconPath: 'M12 2l8 4v6c0 5.55-3.84 10.74-8 12-4.16-1.26-8-6.45-8-12V6l8-4zm-2 10l-2-2-1.5 1.5L10 15l6-6-1.5-1.5L10 12z', iconUrl: iconWAF,
  },
  {
    id: 'kms', name: 'AWS KMS', shortName: 'KMS', category: 'Security',
    color: '#DD344C', description: 'Key management service',
    iconPath: 'M12.65 10a6 6 0 11-2.3 0H2v4h2v3h3v-3h3.35M17 10a3 3 0 100 .001', iconUrl: iconKMS,
  },
  {
    id: 'secrets-manager', name: 'AWS Secrets Manager', shortName: 'Secrets Mgr', category: 'Security',
    color: '#DD344C', description: 'Manage and rotate secrets',
    iconPath: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z', iconUrl: iconSecretsManager,
  },

  // ── AI/ML ──────────────────────────────────────────────────────────
  {
    id: 'sagemaker', name: 'Amazon SageMaker', shortName: 'SageMaker', category: 'AI/ML',
    color: '#01A88D', description: 'Build, train, and deploy ML models',
    iconPath: 'M12 2a10 10 0 100 20 10 10 0 000-20zm-1 4h2v2h2v2h-2v2h-2v-2H9V8h2V6zm-3 8h8v2H8v-2zm2 4h4v2h-4v-2z', iconUrl: iconSageMaker,
  },
  {
    id: 'bedrock', name: 'Amazon Bedrock', shortName: 'Bedrock', category: 'AI/ML',
    color: '#01A88D', description: 'Foundation models as a service',
    iconPath: 'M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.5l6.5 3.6v7.3L12 19l-6.5-3.6V8.1L12 4.5z', iconUrl: iconBedrock,
  },
  {
    id: 'rekognition', name: 'Amazon Rekognition', shortName: 'Rekognition', category: 'AI/ML',
    color: '#01A88D', description: 'Image and video analysis',
    iconPath: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z', iconUrl: iconRekognition,
  },

  // ── Analytics ──────────────────────────────────────────────────────
  {
    id: 'kinesis', name: 'Amazon Kinesis', shortName: 'Kinesis', category: 'Analytics',
    color: '#8C4FFF', description: 'Real-time data streaming',
    iconPath: 'M7 4c5 0 5 5 0 5s5 0 5 5c0 5-5 5-5 5m10-15c-5 0-5 5 0 5s-5 0-5 5c0 5 5 5 5 5', iconUrl: iconKinesis,
  },
  {
    id: 'athena', name: 'Amazon Athena', shortName: 'Athena', category: 'Analytics',
    color: '#8C4FFF', description: 'Query data in S3 using SQL',
    iconPath: 'M12 2L4 6v12l8 4 8-4V6l-8-4zm0 2l6 3-6 3-6-3 6-3z', iconUrl: iconAthena,
  },
  {
    id: 'glue', name: 'AWS Glue', shortName: 'Glue', category: 'Analytics',
    color: '#8C4FFF', description: 'ETL service',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 16l-2-2 2-2 1.5 1.5L8 15l1.5 1.5L8 16zm8 0l-1.5-1.5L16 13l-1.5-1.5L16 10l2 2-2 2v2z', iconUrl: iconGlue,
  },
  {
    id: 'opensearch', name: 'Amazon OpenSearch', shortName: 'OpenSearch', category: 'Analytics',
    color: '#8C4FFF', description: 'Search and analytics engine',
    iconPath: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z', iconUrl: iconOpenSearch,
  },

  // ── Management ─────────────────────────────────────────────────────
  {
    id: 'cloudwatch', name: 'Amazon CloudWatch', shortName: 'CloudWatch', category: 'Management',
    color: '#E7157B', description: 'Monitoring and observability',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', iconUrl: iconCloudWatch,
  },
  {
    id: 'cloudformation', name: 'AWS CloudFormation', shortName: 'CloudFormation', category: 'Management',
    color: '#E7157B', description: 'Infrastructure as code',
    iconPath: 'M12 2l-8 4v12l8 4 8-4V6l-8-4zm-2 8l2-2 2 2-2 2-2-2zm0 4l2 2 2-2', iconUrl: iconCloudFormation,
  },
  {
    id: 'cloudtrail', name: 'AWS CloudTrail', shortName: 'CloudTrail', category: 'Management',
    color: '#E7157B', description: 'Track user activity and API usage',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9l2-2 3 3 5-5 2 2-7 7-5-5z', iconUrl: iconCloudTrail,
  },
  {
    id: 'systems-manager', name: 'AWS Systems Manager', shortName: 'SSM', category: 'Management',
    color: '#E7157B', description: 'Operational management',
    iconPath: 'M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.04 7.04 0 00-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84a.48.48 0 00-.48.41L9.25 5.35a7.04 7.04 0 00-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.73 8.87a.48.48 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94', iconUrl: iconSystemsManager,
  },

  // ── Integration ────────────────────────────────────────────────────
  {
    id: 'sqs', name: 'Amazon SQS', shortName: 'SQS', category: 'Integration',
    color: '#E7157B', description: 'Managed message queuing service',
    iconPath: 'M4 4h16v16H4V4zm3 4h10v2H7V8zm0 4h10v2H7v-2zm0 4h6v2H7v-2z', iconUrl: iconSQS,
  },
  {
    id: 'sns', name: 'Amazon SNS', shortName: 'SNS', category: 'Integration',
    color: '#E7157B', description: 'Pub/sub messaging service',
    iconPath: 'M12 2L4 7v10l8 5 8-5V7l-8-5zm0 4l4 2.5v5L12 16l-4-2.5v-5L12 6z', iconUrl: iconSNS,
  },
  {
    id: 'step-functions', name: 'AWS Step Functions', shortName: 'Step Fn', category: 'Integration',
    color: '#E7157B', description: 'Visual workflows for applications',
    iconPath: 'M12 2v4m0 12v4m-6-6l-4 4m16-4l-4 4M6 6L2 2m16 4l4-4M12 8a4 4 0 100 8 4 4 0 000-8z', iconUrl: iconStepFunctions,
  },
  {
    id: 'eventbridge', name: 'Amazon EventBridge', shortName: 'EventBridge', category: 'Integration',
    color: '#E7157B', description: 'Serverless event bus',
    iconPath: 'M4 4l8 4 8-4M4 12l8 4 8-4M4 20l8-4 8 4M12 8v4m0 4v4', iconUrl: iconEventBridge,
  },
  {
    id: 'mq', name: 'Amazon MQ', shortName: 'MQ', category: 'Integration',
    color: '#E7157B', description: 'Managed message broker',
    iconPath: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 6l-4 4h3v4h2v-4h3l-4-4z', iconUrl: iconMQ,
  },

  // ── Developer Tools ────────────────────────────────────────────────
  {
    id: 'codepipeline', name: 'AWS CodePipeline', shortName: 'CodePipeline', category: 'Developer Tools',
    color: '#C925D1', description: 'Continuous delivery service',
    iconPath: 'M4 6h4v12H4V6zm6 0h4v12h-4V6zm6 0h4v12h-4V6z', iconUrl: iconCodePipeline,
  },
  {
    id: 'codecommit', name: 'AWS CodeCommit', shortName: 'CodeCommit', category: 'Developer Tools',
    color: '#C925D1', description: 'Source control service',
    iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3 0 1.12-.61 2.09-1.5 2.61v2.89h-3V10.61C9.61 10.09 9 9.12 9 8c0-1.66 1.34-3 3-3zm-3 11.61c-.89-.52-1.5-1.49-1.5-2.61h3v1.5h3V14h3c0 1.12-.61 2.09-1.5 2.61V19h-3v-2.39h-3V19H9v-2.39z', iconUrl: iconCodeCommit,
  },
  {
    id: 'codebuild', name: 'AWS CodeBuild', shortName: 'CodeBuild', category: 'Developer Tools',
    color: '#C925D1', description: 'Build and test code',
    iconPath: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z', iconUrl: iconCodeBuild,
  },
  {
    id: 'cdk', name: 'AWS CDK', shortName: 'CDK', category: 'Developer Tools',
    color: '#C925D1', description: 'Cloud Development Kit',
    iconPath: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z', iconUrl: iconCDK,
  },

  // ── Security (additional) ──────────────────────────────────────────
  {
    id: 'verified-permissions', name: 'Amazon Verified Permissions', shortName: 'Verified Perms', category: 'Security',
    color: '#DD344C', description: 'Fine-grained authorization for applications',
    iconPath: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 11l-3-3 1.41-1.41L11 10.17l4.59-4.58L17 7l-6 6z', iconUrl: iconVerifiedPermissions,
  },
];

/** Get services for a specific category */
export function getServicesByCategory(category: AWSCategory): AWSService[] {
  return AWS_SERVICES.filter(s => s.category === category);
}

/** Get all unique categories from the service list */
export function getCategories(): AWSCategory[] {
  const cats = new Set<AWSCategory>();
  for (const s of AWS_SERVICES) cats.add(s.category);
  return [...cats];
}

/** Find a service by its id */
export function getServiceById(id: string): AWSService | undefined {
  return AWS_SERVICES.find(s => s.id === id);
}
