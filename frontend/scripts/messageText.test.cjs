const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const filename = path.resolve(__dirname, '../src/components/MessageText.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);
const render = message => renderToStaticMarkup(React.createElement(loaded.exports.default, { message }));

assert.equal(render({ id: 'broadcast_old', text: '<b><i>Chúc mừng</i></b> &amp; vui vẻ' }), '<strong><em>Chúc mừng</em></strong> &amp; vui vẻ');
assert.equal(render({ id: 'new', text: '🎉 Xin chào', entities: [{ type: 'bold', offset: 3, length: 8 }] }), '🎉 <strong>Xin chào</strong>');
assert.equal(render({ id: 'ordinary', text: '<b>literal</b>' }), '&lt;b&gt;literal&lt;/b&gt;');
assert.equal(render({ id: 'broadcast_old', text: '<a href="javascript:alert(1)">click</a><script>alert(1)</script>' }), 'click&lt;script&gt;alert(1)&lt;/script&gt;');
assert.equal(render({ id: 'new', text: 'abc', entities: [{ type: 'bold', offset: -1, length: 5 }] }), 'abc');
assert.match(render({ id: 'new', text: 'Link', entities: [{ type: 'text_link', offset: 0, length: 4, url: 'https://example.com' }] }), /href="https:\/\/example.com"/);
console.log('6 message formatting checks passed');
assert.equal(loaded.exports.getMessageContent({ id: 'broadcast_old', text: '💞 <b><i>NHÂN DỊP TẾT</i></b> &amp; năm mới' }).text, '💞 NHÂN DỊP TẾT & năm mới');
assert.equal(loaded.exports.getMessageContent({ id: 'ordinary', text: '<b>literal</b>' }).text, '<b>literal</b>');
console.log('2 conversation preview checks passed');
assert.equal(loaded.exports.getMessageContent({ id: 'callback_old', isOutgoing: false, text: 'Khách chọn: Tư vấn sản phẩm' }).text, 'Tư vấn sản phẩm');
assert.equal(loaded.exports.getMessageContent({ id: 'ordinary', isOutgoing: false, text: 'Khách chọn: Tư vấn sản phẩm' }).text, 'Khách chọn: Tư vấn sản phẩm');
console.log('2 button selection checks passed');
