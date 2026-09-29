// 토큰 유무에 따라 첫 화면을 고른다.
import { getToken } from '../session.js';

location.replace(getToken() ? 'accounts.html' : 'login.html');
