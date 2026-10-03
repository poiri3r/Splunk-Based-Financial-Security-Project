// 아이디 찾기 (작업 요청서 R2): 계좌 증명 또는 복구 코드 → 아이디 전체 표시.
// v6는 이름+전화번호로 조회하지 않고, 가입일도 돌려주지 않는다. 결과를 가공(마스킹)하지 않고 그대로 보여 준다.
import { api } from '../api.js';
import { getToken } from '../session.js';
import { clearErrors, setBusy } from '../ui.js';
import { setupProof, readProof, clearProofSecrets, showProofError } from '../recovery-proof.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const form = document.getElementById('find-id-form');
const submit = form.querySelector('button[type="submit"]');
setupProof(form);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  const proof = readProof(form, 'USERNAME');
  if (!proof) return;

  setBusy(submit, true, '확인 중…');
  try {
    const res = await api.verifyRecovery(proof); // { username }
    clearProofSecrets(form);
    document.getElementById('found-id').textContent = res.username;
    form.hidden = true;
    document.getElementById('find-id-result').hidden = false;
  } catch (err) {
    showProofError(form, err);
  } finally {
    setBusy(submit, false);
  }
});
