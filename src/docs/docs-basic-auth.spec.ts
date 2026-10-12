import { matchesDocsBasicAuth } from './docs-basic-auth';

const expected = { username: 'docs-reader', password: 'correct-horse-battery' };
const header = (value: string) =>
  `Basic ${Buffer.from(value).toString('base64')}`;

describe('matchesDocsBasicAuth', () => {
  it('사용자 이름과 비밀번호가 모두 같을 때만 통과한다', () => {
    expect(
      matchesDocsBasicAuth(
        header('docs-reader:correct-horse-battery'),
        expected,
      ),
    ).toBe(true);
    expect(matchesDocsBasicAuth(header('docs-reader:wrong'), expected)).toBe(
      false,
    );
    expect(
      matchesDocsBasicAuth(header('other:correct-horse-battery'), expected),
    ).toBe(false);
  });

  it('비밀번호에 콜론이 있어도 첫 콜론까지만 사용자 이름으로 본다', () => {
    const withColon = { username: 'u', password: 'pass:word:with:colons' };
    expect(
      matchesDocsBasicAuth(header('u:pass:word:with:colons'), withColon),
    ).toBe(true);
  });

  it('헤더가 없거나 Basic이 아니거나 형식이 틀리면 통과하지 못한다', () => {
    expect(matchesDocsBasicAuth(undefined, expected)).toBe(false);
    expect(matchesDocsBasicAuth('', expected)).toBe(false);
    expect(matchesDocsBasicAuth('Bearer abc', expected)).toBe(false);
    expect(matchesDocsBasicAuth('Basic', expected)).toBe(false);
    expect(matchesDocsBasicAuth(header('no-colon-here'), expected)).toBe(false);
    expect(matchesDocsBasicAuth('Basic %%%', expected)).toBe(false);
  });

  it('스킴 이름의 대소문자는 구분하지 않는다', () => {
    expect(
      matchesDocsBasicAuth(
        `basic ${Buffer.from('docs-reader:correct-horse-battery').toString('base64')}`,
        expected,
      ),
    ).toBe(true);
  });

  it('길이가 다른 값도 오류 없이 거부한다', () => {
    expect(matchesDocsBasicAuth(header('a:b'), expected)).toBe(false);
    expect(
      matchesDocsBasicAuth(
        header(`${'a'.repeat(5000)}:${'b'.repeat(5000)}`),
        expected,
      ),
    ).toBe(false);
  });
});
