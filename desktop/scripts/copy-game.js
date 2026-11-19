// Копирует игру и ассеты в desktop/renderer перед сборкой exe.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'renderer');

fs.mkdirSync(out, { recursive: true });

const files = ['index.html'];
for (const f of files) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}

// vendor-библиотеки (three, rapier) кладём рядом, если они есть
const vendorSrc = path.join(root, 'vendor');
if (fs.existsSync(vendorSrc)) {
  fs.cpSync(vendorSrc, path.join(out, 'vendor'), { recursive: true });
}

// ассеты моделей и звука
const assetsSrc = path.join(root, 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, path.join(out, 'assets'), { recursive: true });
}

console.log('renderer готов:', out);
