// Release checks for the manifest, theme and text contrast.
// Uses only Node built-ins. Edit the theme JSON directly; no generation step.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

const assert = require('assert/strict');
const color = value => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
const transparentKeys = [
  'editor.findMatchHighlightBackground', 'editor.inactiveSelectionBackground',
  'editor.wordHighlightBackground', 'editor.wordHighlightStrongBackground',
  'editor.wordHighlightTextBackground', 'editor.foldBackground',
  'editor.selectionHighlightBackground',
  'diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground',
  'diffEditor.insertedLineBackground', 'diffEditor.removedLineBackground',
];
for (const key of ['name', 'displayName', 'description', 'publisher', 'version']) {
  assert(pkg[key], 'Missing package field: ' + key);
}
assert(/^\d+\.\d+\.\d+$/.test(pkg.version), 'Invalid release version');
assert(pkg.engines.vscode && pkg.categories.includes('Themes'), 'Missing VS Code theme metadata');
assert.equal(pkg.license, 'MIT');
const license = fs.readFileSync(path.join(root, 'LICENSE.md'), 'utf8');
assert(license.includes('MIT License') && license.includes('gruber-darker-theme'), 'Missing license or upstream attribution');
for (const file of [pkg.icon, 'README.md', 'CHANGELOG.md']) assert(fs.existsSync(path.join(root, file)), 'Missing ' + file);
assert(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').includes('## ' + pkg.version + '\n'), 'Missing changelog entry for release');
assert(pkg.contributes.themes.length > 0, 'No contributed theme');


function rgba(hex) {
  let s = hex.slice(1);
  if (s.length <= 4) s = [...s].map(c => c + c).join('');
  return [0, 2, 4, 6].map((i) => i === 6 ? (parseInt(s.slice(i, i + 2) || 'ff', 16) / 255) : parseInt(s.slice(i, i + 2), 16));
}
function over(front, back) {
  return front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])).concat(1);
}
function luminance(rgb) {
  const v = rgb.slice(0, 3).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
}
function contrast(fg, bg) {
  const a = luminance(over(rgba(fg), bg)), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
let failures = 0;
for (const entry of pkg.contributes.themes) {
  const theme = JSON.parse(fs.readFileSync(path.join(root, entry.path), 'utf8'));
  const c = theme.colors;

  assert.equal(theme.type, 'dark');
  assert.equal(entry.uiTheme, 'vs-dark');
  for (const [key, value] of Object.entries(c)) assert(color(value), 'Invalid color: ' + key);
  for (const key of transparentKeys) {
    assert(c[key] && rgba(c[key])[3] < 1, key + ' must be transparent');
  }
  for (const prefix of ['editorInlayHint.', 'editorInlayHint.type', 'editorInlayHint.parameter']) {
    const key = prefix + (prefix.endsWith('.') ? 'background' : 'Background');
    assert.equal(rgba(c[key])[3], 0, key + ' must not interrupt selections');
  }
  for (const [focused, base] of [
    ['list.focusBackground', 'sideBar.background'],
    ['list.activeSelectionBackground', 'sideBar.background'],
    ['editorSuggestWidget.selectedBackground', 'editorSuggestWidget.background'],
    ['quickInputList.focusBackground', 'quickInput.background'],
    ['menu.selectionBackground', 'menu.background'],
  ]) {
    assert(contrast(c[focused], rgba(c[base])) >= 1.3, focused + ' must stand out from its surface');
  }
  assert(contrast(c['tab.activeBackground'], rgba(c['tab.inactiveBackground'])) >= 1.15, 'Active and inactive tabs must differ');
  // Selection needs a visible boundary as well as readable text. The 1.5:1
  // surface threshold is a project regression guard, not a WCAG text rule.
  for (const base of ['editor.background', 'editor.lineHighlightBackground']) {
    const selected = over(rgba(c['editor.selectionBackground']), rgba(c[base]));
    assert(contrast(c[base], selected) >= 1.5, 'Selection must stand out against ' + base);
  }
  const scoped = pkg.contributes.configurationDefaults['workbench.colorCustomizations']['[' + entry.label + ']'];
  assert(scoped, 'Missing theme-scoped tab defaults');
  for (const [key, value] of Object.entries(scoped)) {
    assert(color(value), 'Invalid tab color: ' + key);
    const twin = key.replace(/^modernEditorTab\./, 'tab.');
    if (c[twin]) assert.equal(value, c[twin], 'Tab color mismatch: ' + key);
  }
  assert(theme.tokenColors.length > 0 && theme.semanticHighlighting, 'Missing syntax highlighting');
  const scopes = new Set();
  for (const rule of theme.tokenColors) {
    for (const field of ['foreground', 'background']) {
      if (rule.settings[field] !== undefined) assert(color(rule.settings[field]), 'Invalid token color: ' + rule.name);
    }
    const style = rule.settings.fontStyle;
    if (style) assert(style.split(' ').every(s => ['bold', 'italic', 'underline', 'strikethrough'].includes(s)), 'Invalid font style');
    const list = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    for (const scope of list) {
      assert(typeof scope === 'string' && scope.trim(), 'Missing token scope');
      assert(!scopes.has(scope), 'Duplicate token scope: ' + scope);
      scopes.add(scope);
    }
  }
  for (const [selector, value] of Object.entries(theme.semanticTokenColors)) {
    const fg = typeof value === 'string' ? value : value.foreground;
    if (fg !== undefined) assert(color(fg), 'Invalid semantic color: ' + selector);
  }

  let checks = 0, minimum = Infinity;
  function check(label, fg, bg) {
    const ratio = contrast(fg, bg);
    checks++;
    minimum = Math.min(minimum, ratio);
    if (ratio < 4.5) {
      console.error(`${entry.label}: ${label}: ${ratio.toFixed(2)}:1 (requires 4.5:1)`);
      failures++;
    }
  }
  function pair(fg, bg) {
    if (!c[fg] || !c[bg]) throw new Error(`Missing contrast pair: ${fg} / ${bg}`);
    check(`${fg} on ${bg}`, c[fg], over(rgba(c[bg]), rgba(c['editor.background'])));
  }

  // All explicitly paired components, including status, buttons and menus.
  for (const key of Object.keys(c).filter(k => /foreground$/i.test(k))) {
    const bg = key.replace(/foreground$/i, key.endsWith('Foreground') ? 'Background' : 'background');
    if (c[bg]) pair(key, bg);
  }
  const surfaces = ['editor.background', 'sideBar.background', 'panel.background', 'editorWidget.background', 'quickInput.background', 'menu.background', 'notifications.background'];
  for (const fg of ['foreground', 'descriptionForeground', 'disabledForeground', 'errorForeground', 'textLink.foreground', 'textLink.activeForeground']) {
    for (const bg of surfaces) pair(fg, bg);
  }
  const specific = {
    'commandCenter.inactiveForeground': ['commandCenter.background'],
    'icon.foreground': ['sideBar.background', 'titleBar.activeBackground', 'editor.background'],
    'activityBar.inactiveForeground': ['activityBar.background'],
    'editorLineNumber.foreground': ['editor.background', 'editor.lineHighlightBackground'],
    'editorLineNumber.activeForeground': ['editor.background', 'editor.lineHighlightBackground'],
    'editorGhostText.foreground': ['editor.background', 'editor.lineHighlightBackground'],
    'editorCodeLens.foreground': ['editor.background'],
    'input.placeholderForeground': ['input.background'],
    'sideBarTitle.foreground': ['sideBar.background'],
    'panelTitle.activeForeground': ['panel.background'],
    'panelTitle.inactiveForeground': ['panel.background'],
    'button.foreground': ['button.hoverBackground'],
    'button.secondaryForeground': ['button.secondaryHoverBackground'],
    'editorSuggestWidget.highlightForeground': ['editorSuggestWidget.background'],
    'editorSuggestWidget.focusHighlightForeground': ['editorSuggestWidget.selectedBackground'],
    'editorSuggestWidgetStatus.foreground': ['editorSuggestWidget.background'],
    'quickInputList.focusHighlightForeground': ['quickInputList.focusBackground'],
    'pickerGroup.foreground': ['quickInput.background'],
    'peekViewResult.fileForeground': ['peekViewResult.background', 'peekViewResult.selectionBackground'],
    'peekViewResult.lineForeground': ['peekViewResult.background', 'peekViewResult.selectionBackground'],
    'peekViewTitleLabel.foreground': ['peekViewTitle.background'],
    'peekViewTitleDescription.foreground': ['peekViewTitle.background'],
    'settings.headerForeground': ['editor.background'],
    'settings.settingsHeaderHoverForeground': ['editor.background'],
  };
  for (const [fg, backgrounds] of Object.entries(specific)) for (const bg of backgrounds) pair(fg, bg);
  const listSurfaces = ['sideBar.background', 'list.activeSelectionBackground', 'list.inactiveSelectionBackground', 'list.focusBackground', 'list.hoverBackground', 'quickInput.background', 'quickInputList.focusBackground', 'editorSuggestWidget.selectedBackground', 'menu.selectionBackground'];
  for (const fg of ['foreground', 'descriptionForeground', 'list.highlightForeground', 'list.focusHighlightForeground', 'list.deemphasizedForeground', 'list.errorForeground', 'list.warningForeground', ...Object.keys(c).filter(k => k.startsWith('gitDecoration.'))]) {
    for (const bg of listSurfaces) pair(fg, bg);
  }
  for (const fg of Object.keys(c).filter(k => k.startsWith('terminal.ansi'))) {
    // ANSI black is intentionally dark: terminal apps also use it as a
    // background and as text on light ANSI backgrounds (e.g. status bars).
    if (fg !== 'terminal.ansiBlack') pair(fg, 'terminal.background');
    pair(c['terminal.selectionForeground'] ? 'terminal.selectionForeground' : fg, 'terminal.selectionBackground');
    if (fg !== 'terminal.ansiBlack') {
      pair(fg, 'terminal.ansiBlack');
      pair('terminal.ansiBlack', fg);
    }
  }
  for (const name of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    assert(luminance(rgba(c['terminal.ansiBright' + name])) > luminance(rgba(c['terminal.ansi' + name])), 'ANSI bright ' + name + ' must be lighter');
  }
  for (const fg of ['editorInlayHint.foreground', 'editorInlayHint.typeForeground', 'editorInlayHint.parameterForeground']) {
    for (const base of ['editor.background', 'editor.lineHighlightBackground']) {
      pair(fg, base);
      for (const overlay of ['editor.selectionBackground', 'editor.inactiveSelectionBackground']) {
        check(`${fg} on ${overlay} over ${base}`, c[fg], over(rgba(c[overlay]), rgba(c[base])));
      }
    }
  }
  // Syntax must survive selection, search, diff and line highlighting, not
  // just the bare editor canvas. Never allow transparent bracket glyphs.
  const syntax = [
    ['editor.foreground', c['editor.foreground']],
    ...theme.tokenColors.filter(r => r.settings.foreground).map(r => [r.name, r.settings.foreground]),
    ...Object.entries(theme.semanticTokenColors).map(([name, value]) => [name, typeof value === 'string' ? value : value.foreground]).filter(([, value]) => value),
    ...Object.entries(c).filter(([key]) => key.startsWith('editorBracketHighlight.')),
  ];
  const editorSurfaces = ['editor.background', 'editorWidget.background', 'peekViewEditor.background', 'textCodeBlock.background', 'textBlockQuote.background'];
  const overlays = ['editor.selectionBackground', 'editor.inactiveSelectionBackground', 'editor.selectionHighlightBackground', 'editor.findMatchBackground', 'editor.findMatchHighlightBackground', 'editor.wordHighlightBackground', 'editor.wordHighlightStrongBackground', 'editor.wordHighlightTextBackground', 'editor.foldBackground', 'editor.stackFrameHighlightBackground', 'editorBracketMatch.background', 'diffEditor.insertedTextBackground', 'diffEditor.removedTextBackground', 'diffEditor.insertedLineBackground', 'diffEditor.removedLineBackground'];
  for (const [label, fg] of syntax) {
    for (const bg of editorSurfaces) check(`${label} on ${bg}`, fg, rgba(c[bg]));
    for (const base of ['editor.background', 'editor.lineHighlightBackground']) {
      check(`${label} on ${base}`, fg, rgba(c[base]));
      // In a dark theme, VS Code retains syntax colors even when an
      // editor.selectionForeground is provided (that override is HC-only).
      for (const overlay of overlays) check(`${label} on ${overlay} over ${base}`, fg, over(rgba(c[overlay]), rgba(c[base])));
      for (const kind of ['inserted', 'removed']) {
        const line = over(rgba(c[`diffEditor.${kind}LineBackground`]), rgba(c[base]));
        check(`${label} on layered ${kind} diff over ${base}`, fg, over(rgba(c[`diffEditor.${kind}TextBackground`]), line));
      }
    }
  }
  console.log(`${entry.label}: ${checks} text contrast checks; minimum ${minimum.toFixed(2)}:1`);
}
if (failures) {
  console.error(`FAILED: ${failures} text contrast checks`);
  process.exit(1);
}
console.log('OK: all checked text meets WCAG AA (4.5:1)');
