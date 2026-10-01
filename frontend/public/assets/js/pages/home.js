// 메인: 배너 슬라이드, 로그인 상태면 대표 계좌(목록의 첫 계좌) 요약.
// 로그인 박스의 비회원/회원 전환 자체는 layout.js가 한다.
import { getToken } from '../session.js';
import { formatAmount } from '../format.js';
import { showApiError, transactionsLink } from '../ui.js';

setupSlider(document.querySelector('[data-slider]'));
if (getToken()) loadRepresentativeAccount();

async function loadRepresentativeAccount() {
  // api.js는 목 모듈까지 불러오므로 로그인 상태일 때만 가져온다.
  const { api } = await import('../api.js');
  const box = document.getElementById('rep-account');
  const loading = document.getElementById('rep-loading');
  try {
    const accounts = await api.listAccounts();
    if (accounts.length === 0) {
      document.getElementById('rep-empty').hidden = false;
      return;
    }
    const [first] = accounts;
    document.getElementById('rep-number').textContent = first.number;
    document.getElementById('rep-balance').textContent = formatAmount(first.balance);
    document.getElementById('rep-history').href = transactionsLink(first.number);
    document.getElementById('rep-detail').hidden = false;
  } catch (err) {
    showApiError(box, err);
  } finally {
    loading.hidden = true;
  }
}

function setupSlider(root) {
  if (!root) return;
  const slides = [...root.querySelectorAll('[data-slide]')];
  const status = root.querySelector('[data-slide-status]');
  const toggle = root.querySelector('[data-slide-toggle]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let timer = null;

  function show(next) {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    status.textContent = `${index + 1} / ${slides.length}`;
  }
  function play() {
    stop();
    timer = setInterval(() => show(index + 1), 5000);
    toggle.textContent = '정지';
    toggle.setAttribute('aria-label', '자동 넘김 정지');
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    toggle.textContent = '재생';
    toggle.setAttribute('aria-label', '자동 넘김 재생');
  }

  root.querySelector('[data-slide-prev]').addEventListener('click', () => show(index - 1));
  root.querySelector('[data-slide-next]').addEventListener('click', () => show(index + 1));
  toggle.addEventListener('click', () => (timer ? stop() : play()));
  show(0);
  if (reduceMotion) stop();
  else play();
}
