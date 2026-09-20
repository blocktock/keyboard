const layout = KEYBOARD_LAYOUTS['108'];
const board = document.getElementById('testerKeyboard');
const stage = document.getElementById('testerStage');
const testedCountEl = document.getElementById('testedCount');
const currentKeyEl = document.getElementById('currentKey');
const currentCodeEl = document.getElementById('currentCode');
const pressCountEl = document.getElementById('pressCount');
const progressBar = document.getElementById('progressBar');
const remainingText = document.getElementById('remainingText');
const testStatus = document.getElementById('testStatus');
const toggleTest = document.getElementById('toggleTest');
const showPending = document.getElementById('showPending');
const resetTest = document.getElementById('resetTest');
const completeToast = document.getElementById('completeToast');

const directCodes = {
  Esc:'Escape',Print:'PrintScreen',Scroll:'ScrollLock',Pause:'Pause',M1:'F13',M2:'F14',M3:'F15',M4:'F16',
  '`':'Backquote','1':'Digit1','2':'Digit2','3':'Digit3','4':'Digit4','5':'Digit5','6':'Digit6','7':'Digit7','8':'Digit8','9':'Digit9','0':'Digit0','-':'Minus','=':'Equal',Backspace:'Backspace',
  Tab:'Tab',Q:'KeyQ',W:'KeyW',E:'KeyE',R:'KeyR',T:'KeyT',Y:'KeyY',U:'KeyU',I:'KeyI',O:'KeyO',P:'KeyP','[':'BracketLeft',']':'BracketRight','\\':'Backslash',
  Caps:'CapsLock',A:'KeyA',S:'KeyS',D:'KeyD',F:'KeyF',G:'KeyG',H:'KeyH',J:'KeyJ',K:'KeyK',L:'KeyL',';':'Semicolon',"'":'Quote',Enter:'Enter',
  Z:'KeyZ',X:'KeyX',C:'KeyC',V:'KeyV',B:'KeyB',N:'KeyN',M:'KeyM',',':'Comma','.':'Period','/':'Slash',Space:'Space',Fn:'Fn',
  Insert:'Insert',Home:'Home',PageUp:'PageUp',Delete:'Delete',End:'End',PageDown:'PageDown',Up:'ArrowUp',Left:'ArrowLeft',Down:'ArrowDown',Right:'ArrowRight',
  NumLock:'NumLock','Num/':'NumpadDivide','Num*':'NumpadMultiply','Num-':'NumpadSubtract','Num+':'NumpadAdd',NumEnter:'NumpadEnter','Num.':'NumpadDecimal',
  Num0:'Numpad0',Num1:'Numpad1',Num2:'Numpad2',Num3:'Numpad3',Num4:'Numpad4',Num5:'Numpad5',Num6:'Numpad6',Num7:'Numpad7',Num8:'Numpad8',Num9:'Numpad9'
};
for (let index = 1; index <= 12; index += 1) directCodes[`F${index}`] = `F${index}`;

const repeatedCodes = {
  Shift:['ShiftLeft','ShiftRight'],
  Ctrl:['ControlLeft','ControlRight'],
  Option:['AltLeft','AltRight'],
  Command:['MetaLeft','MetaRight']
};
const repeatedIndex = {};
const displayLabels = {Backspace:'⌫',Caps:'Caps Lock',Command:'⌘',Option:'Alt',Space:'Space',Print:'Prt Sc',Scroll:'Scr Lk',Pause:'Pause',PageUp:'Pg Up',PageDown:'Pg Dn',NumLock:'Num',NumEnter:'Enter'};
const specialCodes = new Set(['Fn','F13','F14','F15','F16']);
const tested = new Set();
const pressed = new Set();
let totalPresses = 0;
let active = true;
let pendingOnly = false;
let completionShown = false;

function codeForLabel(label) {
  if (!repeatedCodes[label]) return directCodes[label] || label;
  const index = repeatedIndex[label] || 0;
  repeatedIndex[label] = index + 1;
  return repeatedCodes[label][index] || repeatedCodes[label].at(-1);
}

function createKey(item) {
  if (item.gap) {
    const gap = document.createElement('div');
    gap.className = 'kb-gap';
    gap.style.setProperty('--key-width', item.gap);
    return gap;
  }
  const key = document.createElement('div');
  const code = codeForLabel(item.label);
  key.className = 'kb-key';
  key.dataset.code = code;
  key.dataset.label = item.label;
  key.style.setProperty('--key-width', item.u || 1);
  key.textContent = displayLabels[item.label] || item.label;
  key.title = `${item.label} · ${code}`;
  if (specialCodes.has(code)) key.classList.add('is-special');
  return key;
}

function renderSection(section) {
  const element = document.createElement('div');
  element.className = `kb-section kb-${section.className}`;
  if (section.type === 'rows') {
    section.rows.forEach(items => {
      const row = document.createElement('div');
      row.className = 'kb-row';
      items.forEach(item => row.appendChild(createKey(item)));
      element.appendChild(row);
    });
    return element;
  }
  element.classList.add('kb-grid');
  element.style.setProperty('--grid-cols', section.grid.cols);
  element.style.setProperty('--grid-rows', section.grid.rows);
  section.grid.cells.forEach(item => {
    const key = createKey(item);
    key.style.gridColumn = `${item.col} / span ${item.w}`;
    key.style.gridRow = `${item.row} / span ${item.h}`;
    element.appendChild(key);
  });
  return element;
}

function renderBoard() {
  const top = document.createElement('div');
  top.className = 'kb-top';
  layout.top.forEach(section => top.appendChild(renderSection(section)));
  const body = document.createElement('div');
  body.className = 'kb-body';
  layout.body.forEach(section => body.appendChild(renderSection(section)));
  board.append(top, body);
}

function normalizedCode(event) {
  const aliases = {OSLeft:'MetaLeft',OSRight:'MetaRight',NumpadClear:'NumLock'};
  return aliases[event.code] || event.code;
}

function keyElement(code) {
  return board.querySelector(`[data-code="${CSS.escape(code)}"]`);
}

function updateSummary() {
  const total = board.querySelectorAll('.kb-key').length;
  const count = tested.size;
  testedCountEl.innerHTML = `${count} <small>/ ${total}</small>`;
  progressBar.style.width = `${count / total * 100}%`;
  remainingText.textContent = count === total ? '全部按键均已通过' : `还有 ${total - count} 个按键待测试`;
  pressCountEl.textContent = totalPresses.toLocaleString();
  if (count === total && !completionShown) {
    completeToast.classList.add('show');
    completionShown = true;
  }
}

function onKeyDown(event) {
  if (!active || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  const code = normalizedCode(event);
  const key = keyElement(code);
  currentKeyEl.textContent = key?.dataset.label || event.key || '未知按键';
  currentCodeEl.textContent = key ? code : `${code || 'Unknown'} · 未映射`;
  if (!key || event.repeat || pressed.has(code)) return;
  pressed.add(code);
  tested.add(code);
  totalPresses += 1;
  const hits = Number(key.dataset.hits || 0) + 1;
  key.dataset.hits = hits > 1 ? String(hits) : '';
  key.classList.add('is-down','is-tested');
  updateSummary();
}

function onKeyUp(event) {
  const code = normalizedCode(event);
  pressed.delete(code);
  keyElement(code)?.classList.remove('is-down');
}

function clearPressed() {
  pressed.clear();
  board.querySelectorAll('.is-down').forEach(key => key.classList.remove('is-down'));
}

function setActive(nextActive) {
  active = nextActive;
  clearPressed();
  stage.classList.toggle('is-paused', !active);
  testStatus.classList.toggle('paused', !active);
  testStatus.innerHTML = `<i></i> ${active ? '监听中' : '已暂停'}`;
  toggleTest.innerHTML = active ? '<span>Ⅱ</span> 暂停测试' : '<span>▶</span> 继续测试';
  document.querySelector('.tester-live span').textContent = active ? '监听中' : '已暂停';
  document.querySelector('.tester-live > i').style.background = active ? '' : '#d6a64e';
  if (active) stage.focus({preventScroll:true});
}

function reset() {
  tested.clear();
  pressed.clear();
  totalPresses = 0;
  completionShown = false;
  completeToast.classList.remove('show');
  currentKeyEl.textContent = '等待输入';
  currentCodeEl.textContent = '—';
  board.querySelectorAll('.kb-key').forEach(key => {
    key.classList.remove('is-down','is-tested');
    key.dataset.hits = '';
  });
  updateSummary();
  setActive(true);
}

renderBoard();
updateSummary();
stage.addEventListener('click', () => stage.focus({preventScroll:true}));
window.addEventListener('keydown', onKeyDown, true);
window.addEventListener('keyup', onKeyUp, true);
window.addEventListener('blur', clearPressed);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearPressed(); });
toggleTest.addEventListener('click', () => setActive(!active));
showPending.addEventListener('click', () => {
  pendingOnly = !pendingOnly;
  stage.classList.toggle('focus-pending', pendingOnly);
  showPending.innerHTML = pendingOnly ? '<span>◉</span> 显示全部按键' : '<span>◉</span> 只看未测试';
});
resetTest.addEventListener('click', reset);
document.getElementById('closeToast').addEventListener('click', () => completeToast.classList.remove('show'));
