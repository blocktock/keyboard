// 1U 使用固定像素基准，避免每一行独立拉伸后键帽宽度失真。
const k = (label, u = 1) => ({ label, u });
const gap = (u = 0.5) => ({ gap: u });
const cell = (label, col, row, w = 1, h = 1) => ({ label, col, row, w, h });

const ALPHA_ROWS = [
  [k('Tab', 1.5), k('Q'), k('W'), k('E'), k('R'), k('T'), k('Y'), k('U'), k('I'), k('O'), k('P'), k('['), k(']'), k('\\', 1.5)],
  [k('Caps', 1.75), k('A'), k('S'), k('D'), k('F'), k('G'), k('H'), k('J'), k('K'), k('L'), k(';'), k("'"), k('Enter', 2.25)],
  [k('Shift', 2.25), k('Z'), k('X'), k('C'), k('V'), k('B'), k('N'), k('M'), k(','), k('.'), k('/'), k('Shift', 2.75)]
];

const NUMBER_ROW = [
  k('`'), k('1'), k('2'), k('3'), k('4'), k('5'), k('6'), k('7'), k('8'), k('9'), k('0'), k('-'), k('='), k('Backspace', 2)
];

const BOTTOM_ROW = [
  k('Ctrl', 1.25), k('Command', 1.25), k('Option', 1.25), k('Space', 6.25),
  k('Option', 1.25), k('Command', 1.25), k('Fn'), k('Ctrl', 1.25)
];

const FUNCTION_ROW = [
  k('Esc'), gap(), k('F1'), k('F2'), k('F3'), k('F4'), gap(),
  k('F5'), k('F6'), k('F7'), k('F8'), gap(),
  k('F9'), k('F10'), k('F11'), k('F12')
];

const NAV_GRID = {
  cols: 3,
  rows: 5,
  cells: [
    cell('Insert', 1, 1), cell('Home', 2, 1), cell('PageUp', 3, 1),
    cell('Delete', 1, 2), cell('End', 2, 2), cell('PageDown', 3, 2),
    cell('Up', 2, 4),
    cell('Left', 1, 5), cell('Down', 2, 5), cell('Right', 3, 5)
  ]
};

const NUMPAD_GRID = {
  cols: 4,
  rows: 5,
  cells: [
    cell('NumLock', 1, 1), cell('Num/', 2, 1), cell('Num*', 3, 1), cell('Num-', 4, 1),
    cell('Num7', 1, 2), cell('Num8', 2, 2), cell('Num9', 3, 2), cell('Num+', 4, 2, 1, 2),
    cell('Num4', 1, 3), cell('Num5', 2, 3), cell('Num6', 3, 3),
    cell('Num1', 1, 4), cell('Num2', 2, 4), cell('Num3', 3, 4), cell('NumEnter', 4, 4, 1, 2),
    cell('Num0', 1, 5, 2), cell('Num.', 3, 5)
  ]
};

const COMPACT_68_ROWS = [
  [k('Esc'), k('1'), k('2'), k('3'), k('4'), k('5'), k('6'), k('7'), k('8'), k('9'), k('0'), k('-'), k('='), k('Backspace', 2), k('Delete')],
  [...ALPHA_ROWS[0], k('PageUp')],
  [...ALPHA_ROWS[1], k('PageDown')],
  [k('Shift', 2.25), k('Z'), k('X'), k('C'), k('V'), k('B'), k('N'), k('M'), k(','), k('.'), k('/'), k('Shift', 1.75), k('Up')],
  [k('Ctrl', 1.25), k('Command', 1.25), k('Option', 1.25), k('Space', 6.25), k('Option'), k('Fn'), k('Ctrl'), k('Left'), k('Down'), k('Right')]
];

function compact75Rows(extraKeys) {
  return [  
    [
        ...FUNCTION_ROW,
        gap(0.25),
        ...extraKeys.slice(0, 1)
    ],
    [...NUMBER_ROW, ...extraKeys.slice(1, 2)],
    [...ALPHA_ROWS[0], ...extraKeys.slice(2, 3)],
    [...ALPHA_ROWS[1], ...extraKeys.slice(3, 4)],
    [k('Shift', 2.25), k('Z'), k('X'), k('C'), k('V'), k('B'), k('N'), k('M'), k(','), k('.'), k('/'), k('Shift', 1.75), k('Up')],
    [k('Ctrl', 1.25), k('Command', 1.25), k('Option', 1.25), k('Space', 6.25), k('Option'), k('Fn'), k('Ctrl'), k('Left'), k('Down'), k('Right')]
  ];
}

const KEYBOARD_LAYOUTS = {
  '68': {
    label: '68键 · 65%',
    desc: '紧凑 65%：方向键与导航键并入主键区',
    top: [],
    body: [{ type: 'rows', className: 'main compact-main', rows: COMPACT_68_ROWS }]
  },
  '84': {
    label: '84键 · 75%',
    desc: '84 键紧凑配列：右侧保留完整导航列与方向键',
    top: [],
    body: [{ type: 'rows', className: 'main compact-main', rows: compact75Rows([k('Delete'), k('Home'), k('PageUp'), k('PageDown')]) }]
  },
  '87': {
    label: '87键 · TKL',
    desc: '标准 TKL：主键区与右侧导航/方向键区分离',
    top: [
      { type: 'rows', className: 'function-main', rows: [FUNCTION_ROW] },
      { type: 'rows', className: 'function-nav', rows: [[k('Print'), k('Scroll'), k('Pause')]] }
    ],
    body: [
      { type: 'rows', className: 'main', rows: [NUMBER_ROW, ...ALPHA_ROWS, BOTTOM_ROW] },
      { type: 'grid', className: 'navigation', grid: NAV_GRID }
    ]
  },
  '108': {
    label: '108键 · 全尺寸',
    desc: '全尺寸：主键区、导航区和数字小键盘相互独立',
    top: [
      { type: 'rows', className: 'function-main', rows: [FUNCTION_ROW] },
      { type: 'rows', className: 'function-nav', rows: [[k('Print'), k('Scroll'), k('Pause')]] },
      { type: 'rows', className: 'function-pad', rows: [[k('M1'), k('M2'), k('M3'), k('M4')]] }
    ],
    body: [
      { type: 'rows', className: 'main', rows: [NUMBER_ROW, ...ALPHA_ROWS, BOTTOM_ROW] },
      { type: 'grid', className: 'navigation', grid: NAV_GRID },
      { type: 'grid', className: 'numpad', grid: NUMPAD_GRID }
    ]
  }
};

const REPORT_LAYOUT_MAP = {
  'ansi-75': '84',
  '75': '84',
  '84': '84',
  '68': '68',
  '65': '68',
  '80': '87',
  '87': '87',
  'tkl': '87',
  '108': '108',
  '104': '108',
  'full': '108'
};
