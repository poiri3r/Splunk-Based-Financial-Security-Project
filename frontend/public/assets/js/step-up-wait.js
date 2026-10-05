// 재인증(step-up) 요청 제한 대기 (v6.1 답변서 4절).
// - 서버는 이체 승인·계좌 설정·한도 변경의 step-up을 사용자 기준으로 함께 센다(비밀번호 실패 5분 5회, 전체 요청 1분 30회).
//   제한에 걸리면 429 RATE_LIMITED와 Retry-After(초)를 준다.
// - 남은 시간은 화면을 옮겨도 이어지도록 sessionStorage에 '끝나는 시각'만 저장한다(비밀값 아님). 아이디별로 구분한다.
// - 대기가 끝나도 자동으로 다시 보내지 않는다. 버튼을 다시 켜기만 하고 사용자가 누르게 한다.
// - Retry-After가 없는 429는 여기서 다루지 않는다(다른 API의 429는 헤더가 없을 수 있다). 기존 제한 안내를 그대로 쓴다.

import { getUsername } from './session.js';
import { formatRemaining } from './format.js';

const KEY = 'pb-step-up-until';

function readUntil() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && saved.user === getUsername() && Number.isFinite(saved.until) && saved.until > Date.now()) return saved.until;
  } catch { /* 형식이 깨졌으면 없는 것으로 본다 */ }
  return 0;
}

// 남은 대기 시간(ms). 없으면 0.
export function stepUpWaitMs() {
  return Math.max(0, readUntil() - Date.now());
}

// step-up 오류가 Retry-After 있는 제한이면 끝나는 시각을 저장하고 true. 그 밖의 오류는 false(호출한 쪽이 평소대로 표시).
export function noteStepUpLimit(err) {
  if (err?.code !== 'RATE_LIMITED' || !err.retryAfter) return false;
  // 두 제한이 겹치면 서버가 더 긴 시간을 준다. 이미 저장된 시각보다 짧아지지는 않게 한다.
  const until = Math.max(readUntil(), Date.now() + err.retryAfter * 1000);
  sessionStorage.setItem(KEY, JSON.stringify({ user: getUsername(), until }));
  return true;
}

// scope(폼) 안의 버튼들을 대기 중에 끄고 남은 시간을 안내한다.
// isApplicable(): 지금 이 버튼이 step-up을 보내는 상태인지(예: 이체 결과 불명 재시도는 step-up이 아니므로 막지 않는다).
// 반환한 sync()는 setBusy(false)처럼 버튼을 다시 켠 뒤에 불러 대기 상태를 다시 적용한다.
export function bindStepUpWait(scope, buttons, { isApplicable = () => true } = {}) {
  const note = Object.assign(document.createElement('p'), { className: 'notice warning', hidden: true });
  note.setAttribute('role', 'status');
  scope.prepend(note);
  let timer = null;
  let waiting = false;

  function sync() {
    const left = isApplicable() ? stepUpWaitMs() : 0;
    if (left > 0) {
      waiting = true;
      note.textContent = `요청이 제한되었습니다. ${Math.ceil(left / 1000)}초(${formatRemaining(left)}) 후 다시 시도해 주세요.`;
      note.hidden = false;
      buttons.forEach((b) => { b.disabled = true; });
      if (!timer) timer = setInterval(sync, 1000);
      return;
    }
    clearInterval(timer);
    timer = null;
    note.hidden = true;
    if (waiting) {
      // 대기로 꺼 둔 버튼만 다시 켠다. 대기가 끝나도 자동으로 제출하지 않는다.
      waiting = false;
      buttons.forEach((b) => { b.disabled = false; });
      note.hidden = false;
      note.textContent = '다시 시도할 수 있습니다. 내용을 확인하고 버튼을 눌러 주세요.';
    }
  }

  sync();
  return { sync, isWaiting: () => isApplicable() && stepUpWaitMs() > 0 };
}
