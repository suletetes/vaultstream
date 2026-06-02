import { describe, it, expect } from 'vitest';
import { devConfig, prodConfig, getEnvironmentConfig } from './config';

describe('EnvironmentConfig', () => {
  describe('devConfig', () => {
    it('should use us-east-1 region', () => {
      expect(devConfig.region).toBe('us-east-1');
    });

    it('should use single NAT gateway', () => {
      expect(devConfig.network.natGateways).toBe(1);
    });

    it('should use db.t3.micro for RDS', () => {
      expect(devConfig.database.rdsInstanceClass).toBe('db.t3.micro');
    });

    it('should not enable Multi-AZ', () => {
      expect(devConfig.database.rdsMultiAz).toBe(false);
    });

    it('should have no read replicas', () => {
      expect(devConfig.database.rdsReadReplicas).toBe(0);
    });

    it('should not enable deletion protection', () => {
      expect(devConfig.deletionProtection).toBe(false);
    });
  });

  describe('prodConfig', () => {
    it('should use us-east-1 region', () => {
      expect(prodConfig.region).toBe('us-east-1');
    });

    it('should use dual NAT gateways', () => {
      expect(prodConfig.network.natGateways).toBe(2);
    });

    it('should use db.t3.medium for RDS', () => {
      expect(prodConfig.database.rdsInstanceClass).toBe('db.t3.medium');
    });

    it('should enable Multi-AZ', () => {
      expect(prodConfig.database.rdsMultiAz).toBe(true);
    });

    it('should have 1 read replica', () => {
      expect(prodConfig.database.rdsReadReplicas).toBe(1);
    });

    it('should enable deletion protection', () => {
      expect(prodConfig.deletionProtection).toBe(true);
    });

    it('should enable provisioned concurrency for API Lambda', () => {
      expect(prodConfig.compute.apiProvisionedConcurrency).toBe(2);
    });
  });

  describe('getEnvironmentConfig', () => {
    it('should return dev config for "dev"', () => {
      expect(getEnvironmentConfig('dev')).toBe(devConfig);
    });

    it('should return prod config for "prod"', () => {
      expect(getEnvironmentConfig('prod')).toBe(prodConfig);
    });

    it('should throw for unknown environment', () => {
      expect(() => getEnvironmentConfig('staging' as never)).toThrow(
        'Unknown environment: staging',
      );
    });
  });
});
