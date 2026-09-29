// 입력 검증. 사용자 편의용이며 보안 수단이 아니다. 최종 판단은 서버가 한다.
// 각 함수는 오류 문구(문자열) 또는 null을 돌려준다. parseAmount만 { value, error }.

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const ACCOUNT_RE = /^\d+$/;

export function validateUsername(username) {
  if (!username) return '아이디를 입력해 주세요.';
  if (!USERNAME_RE.test(username)) return '아이디는 영문·숫자·밑줄(_)로 3~32자여야 합니다.';
  return null;
}

// 글자 수(12~64)와 UTF-8 바이트 수(72 이하)를 모두 확인한다.
// 한글은 글자당 3바이트라 한글 30자는 글자 수는 통과하지만 90바이트로 걸린다.
export function validatePassword(password) {
  if (!password) return '비밀번호를 입력해 주세요.';
  // 서버(Java @Size)와 같은 기준인 UTF-16 길이로 센다.
  if (password.length < 12 || password.length > 64) return '비밀번호는 12~64자여야 합니다.';
  if (new TextEncoder().encode(password).length > 72) {
    return '비밀번호가 너무 깁니다. 한글 등은 글자당 여러 바이트를 차지합니다(최대 72바이트).';
  }
  return null;
}

// 계좌번호는 숫자 문자열. 자릿수는 고정하지 않는다(신규 16자리, demo 8자리).
export function validateAccountNumber(number) {
  if (!number) return '계좌번호를 입력해 주세요.';
  if (!ACCOUNT_RE.test(number)) return '계좌번호는 숫자만 입력해 주세요.';
  return null;
}

// 금액 입력 → 요청에 넣을 값.
// 금액 교환 방식(숫자/문자열)은 팀 합의 대기 중이다. 방식이 바뀌면 이 함수만 수정한다.
//
// 정수부 13자리 제한: 유효숫자 15자리 이하 십진수는 double 변환 후 JSON.stringify로
// 되돌려도 같은 숫자열이 보장된다(13 + 소수 2 = 15). 16자리부터는 보장되지 않는다.
const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;

export function parseAmount(input) {
  const text = String(input ?? '').trim().replace(/,/g, '');
  if (!text) return { value: null, error: '금액을 입력해 주세요.' };
  if (!AMOUNT_RE.test(text)) {
    return { value: null, error: '금액은 정수 13자리, 소수점 이하 2자리까지 숫자로 입력해 주세요.' };
  }
  const value = Number(text);
  if (!(value >= 0.01)) return { value: null, error: '금액은 0.01 이상이어야 합니다.' };
  return { value, error: null };
}
