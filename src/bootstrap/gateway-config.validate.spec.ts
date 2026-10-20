import {
  parseGatewayConfig,
  InvalidGatewayConfigError,
} from './gateway-config.validate';

const valid = {
  jwt: { publicKey: 'pem' },
  eureka: { serviceUrl: 'http://eureka:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
};

describe('parseGatewayConfig', () => {
  it('accepts a minimal valid payload', () => {
    expect(() => parseGatewayConfig(valid)).not.toThrow();
  });

  it('accepts eureka.serviceUrl as an array', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        eureka: {
          serviceUrl: ['http://a:8761/eureka', 'http://b:8761/eureka'],
        },
      }),
    ).not.toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => parseGatewayConfig(null)).toThrow(InvalidGatewayConfigError);
    expect(() => parseGatewayConfig('nope')).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a missing jwt.publicKey', () => {
    expect(() => parseGatewayConfig({ ...valid, jwt: {} })).toThrow(
      InvalidGatewayConfigError,
    );
  });

  it('rejects a missing eureka.serviceUrl', () => {
    expect(() => parseGatewayConfig({ ...valid, eureka: {} })).toThrow(
      InvalidGatewayConfigError,
    );
  });

  it('rejects an empty eureka.serviceUrl array', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, eureka: { serviceUrl: [] } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a missing routing', () => {
    expect(() =>
      parseGatewayConfig({ jwt: valid.jwt, eureka: valid.eureka }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a malformed routing.prefixes', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, routing: { prefixes: { a: 1 } } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects an empty routing.prefixes', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, routing: { prefixes: {} } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a malformed rateLimit', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: { ttlSeconds: 'sixty', limit: 100 },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it.each([
    { ttlSeconds: 0, limit: 100 },
    { ttlSeconds: 60, limit: 0 },
    { ttlSeconds: -1, limit: 0 },
    { ttlSeconds: 1.5, limit: -2 },
    { ttlSeconds: 60, limit: 1.5 },
    { ttlSeconds: Infinity, limit: 100 },
    { ttlSeconds: 60, limit: NaN },
    { ttlSeconds: Number.MAX_SAFE_INTEGER + 1, limit: 100 },
  ])('rejects a non-positive-safe-integer global rateLimit %p', (rateLimit) => {
    expect(() => parseGatewayConfig({ ...valid, rateLimit })).toThrow(
      'rateLimit.ttlSeconds and rateLimit.limit must be positive safe integers',
    );
  });

  it('keeps rateLimit undefined when omitted so the defaults apply', () => {
    expect(parseGatewayConfig(valid).rateLimit).toBeUndefined();
  });

  it('rejects a non-array publicPaths', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: '/auth' }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it.each([
    null,
    {},
    '10',
    { ttlSeconds: 60, limit: 0 },
    { ttlSeconds: -1, limit: 10 },
    { ttlSeconds: 60, limit: 1.5 },
    { ttlSeconds: Infinity, limit: 10 },
    { ttlSeconds: 60, limit: '10' },
  ])('rejects malformed SMS policy %j at boot', (sms) => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: { ttlSeconds: 60, limit: 100, sms },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it.each([
    null,
    {},
    '10',
    { ttlSeconds: 60, limit: 0 },
    { ttlSeconds: -1, limit: 10 },
    { ttlSeconds: 60, limit: 1.5 },
    { ttlSeconds: 60, limit: '10' },
  ])('rejects malformed survey policy %j at boot', (survey) => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: { ttlSeconds: 60, limit: 100, survey },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts a well-formed survey policy', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: {
          ttlSeconds: 60,
          limit: 100,
          survey: { ttlSeconds: 60, limit: 30 },
        },
      }),
    ).not.toThrow();
  });

  it('accepts a participantAuthCode policy and rejects a malformed one', () => {
    const withPolicy = (participantAuthCode: unknown) => ({
      ...valid,
      rateLimit: { ttlSeconds: 60, limit: 100, participantAuthCode },
    });
    expect(() =>
      parseGatewayConfig(withPolicy({ ttlSeconds: 600, limit: 5 })),
    ).not.toThrow();
    expect(() =>
      parseGatewayConfig(withPolicy({ ttlSeconds: 600, limit: 0 })),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts a signin policy and rejects a malformed one', () => {
    const withPolicy = (signin: unknown) => ({
      ...valid,
      rateLimit: { ttlSeconds: 60, limit: 100, signin },
    });
    expect(() =>
      parseGatewayConfig(withPolicy({ ttlSeconds: 600, limit: 10 })),
    ).not.toThrow();
    expect(() =>
      parseGatewayConfig(withPolicy({ ttlSeconds: 600, limit: 0 })),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts exact cors origins', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        cors: {
          allowedOrigins: ['https://expo.example.com', 'http://localhost:3000'],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    null,
    {},
    { allowedOrigins: [] },
    { allowedOrigins: ['*'] },
    { allowedOrigins: ['null'] },
    { allowedOrigins: ['https://expo.example.com/'] },
    { allowedOrigins: ['https://expo.example.com/path'] },
    { allowedOrigins: ['expo.example.com'] },
    { allowedOrigins: ['ftp://expo.example.com'] },
    { allowedOrigins: ['https://EXPO.example.com'] },
  ])('rejects cors %j at boot', (cors) => {
    expect(() => parseGatewayConfig({ ...valid, cors })).toThrow(
      InvalidGatewayConfigError,
    );
  });

  it('accepts "METHOD /path" entries in publicPaths', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        publicPaths: ['/health', 'POST /auth', 'PATCH /auth'],
      }),
    ).not.toThrow();
  });

  it('rejects a malformed "METHOD /path" entry in publicPaths', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: ['post /auth'] }),
    ).toThrow(InvalidGatewayConfigError);
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: ['POST auth'] }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts a full payload with routing, rateLimit, and publicPaths', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        port: 3000,
        routing: { prefixes: { '/forms': 'expo-form-server' } },
        rateLimit: { ttlSeconds: 60, limit: 100 },
        publicPaths: ['/auth'],
      }),
    ).not.toThrow();
  });
  describe('bff', () => {
    const token = 'a'.repeat(32);

    it('accepts a token, an empty bff and no bff at all', () => {
      expect(() =>
        parseGatewayConfig({ ...valid, bff: { token } }),
      ).not.toThrow();
      expect(() => parseGatewayConfig({ ...valid, bff: {} })).not.toThrow();
      expect(parseGatewayConfig(valid).bff).toBeUndefined();
    });

    it.each([
      ['a non-object bff', 'x'],
      ['a null bff', null],
      ['a non-string token', { token: 123 }],
      ['a short token', { token: 'a'.repeat(31) }],
      ['a long token', { token: 'a'.repeat(257) }],
      ['a token with a space', { token: `${'a'.repeat(32)} b` }],
      ['a non-ASCII token', { token: `${'a'.repeat(32)}한` }],
    ])('rejects %s', (_name, bff) => {
      expect(() => parseGatewayConfig({ ...valid, bff })).toThrow(
        InvalidGatewayConfigError,
      );
    });

    it('does not put the token in the error message', () => {
      const secret = `${'s'.repeat(32)} leaked`;
      try {
        parseGatewayConfig({ ...valid, bff: { token: secret } });
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidGatewayConfigError);
        expect((error as Error).message).not.toContain('leaked');
      }
    });
  });

  describe('docs', () => {
    const docs = (overrides: Record<string, unknown> = {}) => ({
      ...valid,
      docs: {
        enabled: true,
        title: 'Expo API 문서',
        services: [{ name: '참여', url: '/attendance/v3/api-docs' }],
        ...overrides,
      },
    });

    it('docs가 없거나 꺼져 있으면 services를 검사하지 않는다', () => {
      expect(() => parseGatewayConfig(valid)).not.toThrow();
      expect(() =>
        parseGatewayConfig({ ...valid, docs: { enabled: false } }),
      ).not.toThrow();
    });

    it('올바른 설정을 받아들인다', () => {
      expect(() => parseGatewayConfig(docs())).not.toThrow();
    });

    it.each([
      ['enabled 누락', { enabled: undefined }],
      ['enabled가 문자열', { enabled: 'true' }],
      ['services 누락', { services: undefined }],
      ['services가 빈 배열', { services: [] }],
      ['services가 배열이 아님', { services: { name: 'a', url: '/a' } }],
      ['name이 빈 문자열', { services: [{ name: '', url: '/a' }] }],
      ['name이 문자열이 아님', { services: [{ name: 1, url: '/a' }] }],
      ['url 누락', { services: [{ name: 'a' }] }],
      ['url이 /로 시작하지 않음', { services: [{ name: 'a', url: 'a/b' }] }],
      [
        '외부 스킴',
        { services: [{ name: 'a', url: 'https://evil.example/x' }] },
      ],
      [
        '프로토콜 상대 URL',
        { services: [{ name: 'a', url: '//evil.example/x' }] },
      ],
      ['경로 안의 //', { services: [{ name: 'a', url: '/a//b' }] }],
      ['역슬래시', { services: [{ name: 'a', url: '/\\evil.example' }] }],
      ['공백', { services: [{ name: 'a', url: '/a b' }] }],
      ['title이 빈 문자열', { title: '' }],
      [
        '31개 초과',
        {
          services: Array.from({ length: 31 }, (_, i) => ({
            name: `s${i}`,
            url: `/s${i}/v3/api-docs`,
          })),
        },
      ],
    ])('거부한다: %s', (_label, overrides) => {
      expect(() => parseGatewayConfig(docs(overrides))).toThrow(
        InvalidGatewayConfigError,
      );
    });

    it('30개까지는 받아들인다', () => {
      const services = Array.from({ length: 30 }, (_, i) => ({
        name: `s${i}`,
        url: `/s${i}/v3/api-docs`,
      }));
      expect(() => parseGatewayConfig(docs({ services }))).not.toThrow();
    });

    describe('docs.basicAuth', () => {
      const auth = {
        username: 'docs-reader',
        password: 'correct-horse-battery',
      };

      it('올바른 자격 증명과 tryItOut=false를 받는다', () => {
        expect(() =>
          parseGatewayConfig(
            docs({ basicAuth: auth, requireAuth: true, tryItOut: false }),
          ),
        ).not.toThrow();
      });

      it('requireAuth인데 basicAuth가 없으면 부팅하지 못한다(비밀이 빠져도 문서가 열리지 않게)', () => {
        expect(() => parseGatewayConfig(docs({ requireAuth: true }))).toThrow(
          'docs.basicAuth is required when docs.requireAuth is true',
        );
      });

      it('requireAuth가 아니고 basicAuth도 없으면 지금처럼 인증 없이 통과한다', () => {
        expect(() => parseGatewayConfig(docs())).not.toThrow();
      });

      it.each([
        [{ username: '', password: 'correct-horse-battery' }],
        [{ username: 'a:b', password: 'correct-horse-battery' }],
        [{ username: 'docs-reader', password: 'short' }],
        [{ username: 'docs-reader' }],
        ['docs-reader:correct-horse-battery'],
        [null],
      ])('잘못된 자격 증명 형식은 거부한다 (%j)', (basicAuth) => {
        expect(() => parseGatewayConfig(docs({ basicAuth }))).toThrow(
          /docs\.basicAuth\.(username|password)/,
        );
      });

      it('오류 메시지에 비밀번호를 싣지 않는다', () => {
        try {
          parseGatewayConfig(
            docs({
              basicAuth: { username: 'a:b', password: 'secret-password-1' },
            }),
          );
          throw new Error('should have thrown');
        } catch (error) {
          expect((error as Error).message).not.toContain('secret-password-1');
        }
      });

      it('tryItOut과 requireAuth는 불리언이어야 한다', () => {
        expect(() => parseGatewayConfig(docs({ tryItOut: 'no' }))).toThrow(
          'docs.tryItOut must be a boolean',
        );
        expect(() => parseGatewayConfig(docs({ requireAuth: 'yes' }))).toThrow(
          'docs.requireAuth must be a boolean',
        );
      });
    });

    it('docs가 객체가 아니면 거부한다', () => {
      expect(() => parseGatewayConfig({ ...valid, docs: 'on' })).toThrow(
        InvalidGatewayConfigError,
      );
    });
  });
});
