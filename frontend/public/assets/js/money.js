// 금액: 서버와 십진 문자열("10000.00")로 주고받는다(작업 요청서 R8, B안).
// Number로 바꾸면 16자리부터 반올림되므로 계산·비교는 1/100원 단위 BigInt로만 한다.
// BigInt는 JSON에 직접 넣을 수 없다. 요청에는 항상 toMoney()가 만든 문자열을 넣는다.

// 서버 형식: 정수부 최대 17자리(앞자리 0 금지), 소수부 최대 2자리. 부호·지수·콤마는 허용하지 않는다.
const MONEY_RE = /^(0|[1-9]\d{0,16})(\.\d{1,2})?$/;
// 서버 응답은 음수(출금 원장)일 수 있다.
const SIGNED_RE = /^-?\d+(\.\d+)?$/;

// 사용자 입력 → { value: "1000.00" | null, error }. 콤마와 앞뒤 공백만 걷어 낸다.
export function parseMoneyInput(input) {
  let text = String(input ?? '').trim().replace(/,/g, '');
  if (!text) return { value: null, error: '금액을 입력해 주세요.' };
  // "007"처럼 앞에 붙은 0은 사람이 흔히 넣으므로 정리한다. "0.5"의 0은 남긴다.
  text = text.replace(/^0+(?=\d)/, '');
  if (!MONEY_RE.test(text)) {
    return { value: null, error: '금액은 숫자로, 소수점 이하 두 자리까지 입력해 주세요. (정수 최대 17자리)' };
  }
  const value = toMoney(toCents(text));
  if (toCents(value) < 1n) return { value: null, error: '금액은 0.01 이상이어야 합니다.' };
  return { value, error: null };
}

// "1234.5" / "-1000.00" → 123450n / -100000n. 형식이 아니면 null.
export function toCents(text) {
  const s = typeof text === 'number' ? String(text) : text;
  if (typeof s !== 'string' || !SIGNED_RE.test(s)) return null;
  const negative = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > 2) return null;
  const cents = BigInt(int) * 100n + BigInt(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

// 123450n → "1234.50"
export function toMoney(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// a < b → 음수, 같으면 0, a > b → 양수. 형식이 아니면 null.
export function compareMoney(a, b) {
  const x = toCents(a);
  const y = toCents(b);
  if (x === null || y === null) return null;
  return x === y ? 0 : x < y ? -1 : 1;
}

// "1234567.5" → "1,234,567.50" (원 기호 없음). 형식이 아니면 원문을 그대로 돌려준다.
export function groupMoney(text) {
  const cents = toCents(text);
  if (cents === null) return String(text ?? '-');
  const [int, frac] = toMoney(cents < 0n ? -cents : cents).split('.');
  return `${cents < 0n ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}
