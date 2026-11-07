import { ConfigService } from '@nestjs/config';
import { getAppConfig } from './app-config';
import { isTestEnvironment, validateEnvironment } from './env.validation';

describe('isTestEnvironment', () => {
  it('is true only for the test environment', () => {
    expect(isTestEnvironment('test')).toBe(true);
    expect(isTestEnvironment('production')).toBe(false);
    expect(isTestEnvironment()).toBe(true);
  });
});

describe('validateEnvironment', () => {
  it('applies defaults and the package version', () => {
    expect(validateEnvironment({})).toEqual({
      port: 8000,
      nodeEnv: 'development',
      logLevel: 'info',
      swaggerEnabled: true,
      serviceName: 'calculador-api',
      version: '1.0.0',
      healthHeapThresholdMb: 200,
    });
  });

  it('treats empty strings as unset', () => {
    expect(
      validateEnvironment({
        PORT: '',
        NODE_ENV: '',
        LOG_LEVEL: '',
        SWAGGER_ENABLED: '',
        SERVICE_NAME: '',
        HEALTH_HEAP_THRESHOLD_MB: '',
      }),
    ).toMatchObject({
      port: 8000,
      nodeEnv: 'development',
      logLevel: 'info',
      swaggerEnabled: true,
      serviceName: 'calculador-api',
      healthHeapThresholdMb: 200,
    });
  });

  it('accepts a fully specified environment', () => {
    expect(
      validateEnvironment({
        PORT: '9000',
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
        SWAGGER_ENABLED: 'false',
        SERVICE_NAME: 'billing-api',
        HEALTH_HEAP_THRESHOLD_MB: '128',
        UNRELATED: 'ignored',
      }),
    ).toEqual({
      port: 9000,
      nodeEnv: 'production',
      logLevel: 'warn',
      swaggerEnabled: false,
      serviceName: 'billing-api',
      version: '1.0.0',
      healthHeapThresholdMb: 128,
    });
  });

  it.each([1, 65535, 8000])('accepts numeric port %s', (port) => {
    expect(validateEnvironment({ PORT: port }).port).toBe(port);
  });

  it.each(['1', '65535', '8000'])('accepts string port %s', (port) => {
    expect(validateEnvironment({ PORT: port }).port).toBe(Number(port));
  });

  it.each([
    ['development', 'development'],
    ['production', 'production'],
    ['test', 'test'],
  ] as const)('accepts NODE_ENV %s', (value, expected) => {
    expect(validateEnvironment({ NODE_ENV: value }).nodeEnv).toBe(expected);
  });

  it.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])(
    'accepts LOG_LEVEL %s',
    (level) => {
      expect(validateEnvironment({ LOG_LEVEL: level }).logLevel).toBe(level);
    },
  );

  it.each([true, 'true', 'TRUE'])('accepts swagger enabled as %s', (value) => {
    expect(validateEnvironment({ SWAGGER_ENABLED: value }).swaggerEnabled).toBe(true);
  });

  it.each([false, 'false', 'False'])('accepts swagger disabled as %s', (value) => {
    expect(validateEnvironment({ SWAGGER_ENABLED: value }).swaggerEnabled).toBe(false);
  });

  it.each([1, 200, 8192])('accepts numeric heap threshold %s', (threshold) => {
    expect(validateEnvironment({ HEALTH_HEAP_THRESHOLD_MB: threshold }).healthHeapThresholdMb).toBe(
      threshold,
    );
  });

  it.each(['1', '200', '8192'])('accepts string heap threshold %s', (threshold) => {
    expect(validateEnvironment({ HEALTH_HEAP_THRESHOLD_MB: threshold }).healthHeapThresholdMb).toBe(
      Number(threshold),
    );
  });

  it('rejects a non-string swagger flag', () => {
    expect(() => validateEnvironment({ SWAGGER_ENABLED: 1 })).toThrow(
      'SWAGGER_ENABLED must be true or false',
    );
  });

  it('rejects every invalid value in one error', () => {
    expect(() =>
      validateEnvironment({
        PORT: '0',
        NODE_ENV: 'prod',
        LOG_LEVEL: 'INFO',
        SWAGGER_ENABLED: 'yes',
        SERVICE_NAME: '  api',
        HEALTH_HEAP_THRESHOLD_MB: 'no',
      }),
    ).toThrow(
      [
        'Environment validation failed:',
        '- PORT must be an integer between 1 and 65535',
        '- NODE_ENV must be one of: development, production, test',
        '- LOG_LEVEL must be one of: trace, debug, info, warn, error, fatal, silent',
        '- SWAGGER_ENABLED must be true or false',
        '- SERVICE_NAME must be a non-empty string',
        '- HEALTH_HEAP_THRESHOLD_MB must be an integer between 1 and 8192',
      ].join('\n'),
    );
  });

  it.each([0, 1.5, 65536, Number.NaN, 'abc', '08', '65536', true, '1.5'])(
    'rejects port %s',
    (port) => {
      expect(() => validateEnvironment({ PORT: port })).toThrow(
        'PORT must be an integer between 1 and 65535',
      );
    },
  );

  it.each([0, 1.5, 8193, Number.NaN, '0', '8193', '99999', '200.5', true, ' 200'])(
    'rejects heap threshold %s',
    (threshold) => {
      expect(() => validateEnvironment({ HEALTH_HEAP_THRESHOLD_MB: threshold })).toThrow(
        'HEALTH_HEAP_THRESHOLD_MB must be an integer between 1 and 8192',
      );
    },
  );

  it.each(['   ', 'api ', 12])('rejects SERVICE_NAME %s', (serviceName) => {
    expect(() => validateEnvironment({ SERVICE_NAME: serviceName })).toThrow(
      'SERVICE_NAME must be a non-empty string',
    );
  });
});

describe('getAppConfig', () => {
  it('reads the validated configuration keys', () => {
    const values = {
      port: 8000,
      nodeEnv: 'test' as const,
      logLevel: 'silent' as const,
      swaggerEnabled: true,
      serviceName: 'calculador-api',
      version: '1.0.0',
      healthHeapThresholdMb: 200,
    };
    const configService = {
      getOrThrow: jest.fn((key: string) => values[key as keyof typeof values]),
    } as unknown as ConfigService;

    expect(getAppConfig(configService)).toEqual(values);
    expect(configService.getOrThrow).toHaveBeenCalledWith('port');
    expect(configService.getOrThrow).toHaveBeenCalledWith('version');
    expect(configService.getOrThrow).toHaveBeenCalledWith('healthHeapThresholdMb');
  });
});
