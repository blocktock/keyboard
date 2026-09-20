const rows = [
  ['Esc','1','2','3','4','5','6','7','8','9','0','-','=','⌫'],
  ['Tab','Q','W','E','R','T','Y','U','I','O','P','[',']','\\'],
  ['Caps','A','S','D','F','G','H','J','K','L',';','\'','Enter'],
  ['Shift','Z','X','C','V','B','N','M',',','.','/','Shift'],
  ['Ctrl','⌘','Alt','Space','Alt','Fn','Menu','Ctrl']
];
const heat = { Space:3,D:3,S:3,E:3,A:2,W:2,F:2,J:2,K:2,R:2,N:2,M:2,Shift:1,Enter:1,Ctrl:1,C:1,V:1,I:1,O:1 };
const keyboard = document.getElementById('heroKeyboard');
keyboard.innerHTML = rows.map(row => `<div class="key-row">${row.map(key => {
  const shape = key === 'Space' ? ' space' : ['Tab','Caps','Shift','Enter','Ctrl'].includes(key) ? ' wide' : '';
  return `<i class="key${shape}" data-heat="${heat[key] || 0}">${key}</i>`;
}).join('')}</div>`).join('');

const hotKeys = [...keyboard.querySelectorAll('[data-heat="2"],[data-heat="3"]')];
let activeKey = 0;
window.setInterval(() => {
  hotKeys.forEach(key => key.style.animation = '');
  hotKeys[activeKey++ % hotKeys.length].style.animation = 'keyflash .55s ease';
}, 700);

const heights = [28,38,26,45,58,42,68,72,48,63,82,60,74,92,66,54,78,88,69,51,64,46,36,42];
document.getElementById('rhythmBars').innerHTML = heights.map(height => `<i style="--h:${height}%"></i>`).join('');

const dialog = document.getElementById('downloadDialog');
document.querySelectorAll('[data-open-download]').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  dialog.showModal();
}));
dialog.querySelector('.close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

const params = new URLSearchParams(location.search);
if (params.has('importToken') || params.has('share')) location.replace(`/analyze${location.search}`);
else if (params.has('download')) dialog.showModal();
