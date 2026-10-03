// 계정 복구 증명 폼 (작업 요청서 R2·R3·A7, 추가 협의 C3). 아이디 찾기·비밀번호 재설정·로그인 잠금 해제가 같이 쓴다.
// 증명 방법은 두 가지다. 이름+전화번호만으로 찾는 방식은 v6에 없다.
//   ACCOUNT       : 이름 + 본인 정상 입출금 계좌번호 + 계좌 비밀번호
//   RECOVERY_CODE : 로그인 상태에서 미리 발급한 복구 코드 (검증할 때 소비된다)
// 복구 코드는 한 번 쓰면 사라지므로 이 요청은 자동 재시도하지 않는다(api.verifyRecovery).
//
// HTML(form 안): input[name=method] 라디오, [data-method="ACCOUNT"|"RECOVERY_CODE"] 구역,
//               input name=name / accountNumber / pin / recoveryCode

import { validateName, validateAccountNumber, validatePinFormat } from './validate.js';
import { showFieldError, showFormError, showApiError } from './ui.js';

export function setupProof(form) {
  const sync = () => {
    const method = form.querySelector('input[name="method"]:checked').value;
    form.querySelectorAll('[data-method]').forEach((node) => { node.hidden = node.dataset.method !== method; });
  };
  form.querySelectorAll('input[name="method"]').forEach((radio) => radio.addEventListener('change', sync));
  sync();
}

// 입력 검증 후 요청 본문을 만든다. 오류가 있으면 화면에 표시하고 null.
// 복구 코드 방식은 이름·계좌·PIN을 함께 보내면 서버가 거부하므로 넣지 않는다.
export function readProof(form, purpose) {
  const method = form.querySelector('input[name="method"]:checked').value;
  if (method === 'RECOVERY_CODE') {
    const recoveryCode = form.recoveryCode.value.trim();
    if (!recoveryCode) {
      showFieldError(form, 'recoveryCode', '복구 코드를 입력해 주세요.');
      return null;
    }
    return { purpose, method, recoveryCode };
  }
  // form.name은 폼 자신의 name 속성이라 입력칸은 elements로 꺼낸다.
  const name = form.elements.namedItem('name').value.trim();
  const accountNumber = form.accountNumber.value.trim().replace(/-/g, '');
  const pin = form.pin.value;
  const error = [
    ['name', validateName(name)],
    ['accountNumber', validateAccountNumber(accountNumber)],
    ['pin', validatePinFormat(pin)],
  ].find(([, message]) => message);
  if (error) {
    showFieldError(form, error[0], error[1]);
    return null;
  }
  return { purpose, method, name, accountNumber, pin };
}

// 비밀값 입력칸 비우기 (성공·단계 이동 시)
export function clearProofSecrets(form) {
  form.pin.value = '';
  form.recoveryCode.value = '';
}

// 증명 실패 안내. 불일치·PIN 오류·PIN 잠금·요청 제한을 구분한다.
export function showProofError(form, err) {
  switch (err.code) {
    case 'RECOVERY_INVALID':
      showFormError(form, '입력한 정보로 확인할 수 없습니다. 이름·계좌번호 또는 복구 코드를 다시 확인해 주세요. '
        + '(정상 입출금 계좌와 계좌 비밀번호가 있어야 하며, 복구 코드는 한 번만 쓸 수 있습니다)');
      return;
    case 'PIN_INVALID':
      showFieldError(form, 'pin', '계좌 비밀번호가 올바르지 않습니다. 4번 틀리면 계좌 비밀번호가 잠깁니다.');
      return;
    case 'PIN_LOCKED':
      form.pin.value = '';
      showFormError(form, '계좌 비밀번호가 잠겨 이 계좌로는 확인할 수 없습니다. 복구 코드가 있으면 복구 코드로 확인해 주세요.');
      return;
    case 'RATE_LIMITED':
      showFormError(form, '확인 요청이 너무 많습니다. 잠시 후(최대 1시간) 다시 시도해 주세요.');
      return;
    default:
      showApiError(form, err);
  }
}

