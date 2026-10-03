// 입력 검증. 사용자 편의용이며 보안 수단이 아니다. 최종 판단은 서버가 한다.
// 각 함수는 오류 문구(문자열) 또는 null을 돌려준다. parseAmount만 { value, error }.
// 규칙은 백엔드 v6(CredentialPolicy, IdentityService, DTO)와 같게 맞췄다.

import { parseMoneyInput } from './money.js';

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
// 제어문자: 서버는 Character.isISOControl로 거부한다(U+0000~001F, U+007F~009F).
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function validateUsername(username) {
  if (!username) return '아이디를 입력해 주세요.';
  if (!USERNAME_RE.test(username)) return '아이디는 영문·숫자·밑줄(_)로 3~32자여야 합니다.';
  return null;
}

// 같은 문자 4개(aaaa, 1111) 또는 연속 4자(abcd, 4321)가 들어 있는가. 대소문자는 구분하지 않는다.
const SEQUENCES = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba'];
function predictable(value) {
  const lower = value.toLowerCase();
  for (let i = 0; i + 4 <= lower.length; i++) {
    const part = lower.slice(i, i + 4);
    if (new Set(part).size === 1) return true;
    if (SEQUENCES.some((seq) => seq.includes(part))) return true;
  }
  return false;
}

// 로그인 비밀번호. context의 username·phone을 알면 개인정보 포함 여부도 확인한다(모르면 서버가 판단).
// 글자 수(12~64)는 서버(Java @Size)와 같은 UTF-16 길이, 72바이트는 UTF-8 기준이다.
export function validatePassword(password, { username, phone } = {}) {
  if (!password) return '비밀번호를 입력해 주세요.';
  if (password.length < 12 || password.length > 64) return '비밀번호는 12~64자여야 합니다.';
  if (new TextEncoder().encode(password).length > 72) {
    return '비밀번호가 너무 깁니다. 한글 등은 글자당 여러 바이트를 차지합니다(최대 72바이트).';
  }
  if (CONTROL_RE.test(password)) return '비밀번호에 제어문자를 쓸 수 없습니다.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return '비밀번호는 영문·숫자·특수문자를 모두 포함해야 합니다.';
  }
  if (predictable(password)) return '같은 문자 4개 반복이나 연속된 4자(1234, abcd 등)는 쓸 수 없습니다.';
  if (username && password.toLowerCase() === username.toLowerCase()) return '아이디와 같은 비밀번호는 쓸 수 없습니다.';
  const digits = phoneDigits(phone);
  if (digits.length >= 4 && password.includes(digits.slice(-4))) return '휴대폰 번호 끝 4자리를 포함할 수 없습니다.';
  return null;
}

// 이름: 필수, 최대 100자, 제어문자 금지 (작업 요청서 R1. 기존 2~20자 한글·영문 제한은 없앴다)
export function validateName(name) {
  if (!name) return '이름을 입력해 주세요.';
  if (name.length > 100) return '이름은 100자 이내로 입력해 주세요.';
  if (CONTROL_RE.test(name)) return '이름에 쓸 수 없는 문자가 있습니다.';
  return null;
}

// 공백·하이픈만 지운다. 국내 번호(010…)는 서버가 +82 형식으로 바꿔 저장한다.
export const normalizePhone = (phone) => String(phone ?? '').replace(/[\s-]/g, '');
// 서버가 저장하는 형식(01012345678 → +821012345678)의 숫자만. 개인정보 포함 검사를 서버와 같은 문자열로 한다.
function phoneDigits(phone) {
  const p = normalizePhone(phone);
  return (/^0\d{8,10}$/.test(p) ? `82${p.slice(1)}` : p).replace(/\D/g, '');
}

// 서버 정규화 규칙과 같은 범위를 허용한다(추가 협의 C2: 현재 v6 유지 — 국내 번호와 국제 형식 모두 허용).
// 서버가 같은 번호로 여러 아이디 가입을 막지 않으므로 프론트도 중복을 판단하지 않는다.
const PHONE_RE = /^(0\d{8,10}|\+[1-9]\d{7,14})$/;
export function validatePhone(phone) {
  if (!phone) return '휴대폰 번호를 입력해 주세요.';
  if (!PHONE_RE.test(phone)) return '휴대폰 번호를 확인해 주세요. (예: 010-1234-5678 또는 +821012345678)';
  return null;
}

// 계좌번호: 숫자 10~20자리 (수취 계좌 확인·복구 증명의 서버 규칙)
export function validateAccountNumber(number) {
  if (!number) return '계좌번호를 입력해 주세요.';
  if (!/^\d{10,20}$/.test(number)) return '계좌번호는 숫자 10~20자리입니다.';
  return null;
}

// 거래 승인·복구에 입력하는 기존 계좌 비밀번호: 형식만 본다.
export function validatePinFormat(pin) {
  if (!pin) return '계좌 비밀번호를 입력해 주세요.';
  if (!/^\d{4}$/.test(pin)) return '계좌 비밀번호는 숫자 4자리입니다.';
  return null;
}

// 새로 정하는 계좌 비밀번호: 반복·연속 숫자와 휴대폰 번호에 들어 있는 4자리 금지.
export function validatePin(pin, { phone } = {}) {
  const formatError = validatePinFormat(pin);
  if (formatError) return formatError;
  if (predictable(pin)) return '같은 숫자 반복이나 연속된 숫자(1234, 4321)는 쓸 수 없습니다.';
  if (phone && phoneDigits(phone).includes(pin)) return '휴대폰 번호에 들어 있는 숫자 4자리는 쓸 수 없습니다.';
  return null;
}

// 금액 입력 → 요청에 넣을 십진 문자열 { value: "10000.00", error }
export function parseAmount(input) {
  return parseMoneyInput(input);
}
