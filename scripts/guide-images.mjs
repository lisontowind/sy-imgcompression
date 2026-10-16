import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

export async function createGuide({ page, api, put, root, bookA, pdfPath, setActive }) {
  const output = path.join(root, "assets", "guide"); fs.mkdirSync(output, { recursive: true });
  const assets = [
    ["封面设计-20261016090001-demo001.png", "preview-source.png"],
    ["正文配图-20261016090002-demo002.png", "header-source.png"],
    ["图标原稿-20261016090003-demo003.png", "icon-source.png"],
  ];
  for (const [name, source] of assets) {
    await put("/data/assets/" + name, fs.readFileSync(path.join(root, "assets", "branding", source)));
  }
  const documentId = await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/插件使用示例/产品设计周记", markdown:
    assets.map(([name], index) => `## 图片 ${index + 1}\n\n![${name.split("-")[0]}](assets/${name})`).join("\n\n") + `\n\n[项目附件](${pdfPath})` });
  await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/插件使用示例/方案引用", markdown: `![共用封面](assets/${assets[0][0]})` });
  setActive(documentId); await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(page.url());
  await page.evaluate(async () => { localStorage.removeItem("jobs.json"); localStorage.removeItem("settings.json"); await window.__plugin.onload(); window.__open(); });
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.sy-imgcompression-root .syic-status')?.textContent === '就绪');
    await page.waitForFunction(() => !document.querySelector('.sy-imgcompression-root .syic-actions button')?.disabled);
    await page.locator('.syic-thumbnail').evaluateAll(images => Promise.allSettled(images.map(image => image.decode())));
  };
  await ready();

  const manifest = [];
  const guideCSS = `
    body { margin:0; background:#edf3fb !important; font-family:'Microsoft YaHei UI','Microsoft YaHei',sans-serif; }
    .guide-heading { position:fixed;z-index:10001;left:52px;top:36px;width:1496px;color:#16233c;pointer-events:none; }
    .guide-eyebrow { font-size:16px;letter-spacing:2px;color:#3573f0;font-weight:600;margin-bottom:14px; }
    .guide-heading h1 { font-size:42px;letter-spacing:-1px;line-height:1.25;margin:0 0 14px; }
    .guide-heading p { font-size:19px;color:#60718c;margin:0; }
    .guide-page-number { position:fixed;right:56px;top:44px;color:#8396b2;font-size:17px; }
    .guide-notes { position:fixed;z-index:10001;left:1190px;top:212px;width:356px;display:grid;gap:20px; }
    .guide-note { padding:22px 22px 24px;background:white;border:1px solid #dce6f4;border-radius:16px;box-shadow:0 8px 24px #263e6a06; }
    .guide-note h2 { display:flex;align-items:center;gap:12px;margin:0 0 14px;font-size:21px;line-height:1.4;color:#182b49; }
    .guide-note b { display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:#eaf1ff;color:#3573f0;font-size:17px;flex-shrink:0; }
    .guide-note p { color:#60718c;line-height:1.85;margin:0;font-size:18px; }
    .guide-footer { position:fixed;left:54px;bottom:28px;right:54px;display:flex;justify-content:space-between;color:#7386a2;font-size:15px;z-index:10001; }
    .guide-pin { position:fixed;z-index:10002;display:flex;align-items:center;justify-content:center;width:30px;height:30px;color:white;background:#3573f0;border:3px solid white;border-radius:50%;box-shadow:0 3px 12px #244d9d40;font-size:15px;font-weight:700;pointer-events:none; }
  `;
  async function frame(spec) {
    await page.evaluate(({ spec, css }) => {
      document.querySelectorAll('.guide-layer,style[data-guide]').forEach(node => node.remove());
      const style = document.createElement('style'); style.dataset.guide = 'true'; style.textContent = css; document.head.append(style);
      const overlay = document.createElement('div'); overlay.className = 'guide-layer';
      const heading = document.createElement('header'); heading.className = 'guide-heading';
      const eyebrow = document.createElement('div'); eyebrow.className = 'guide-eyebrow'; eyebrow.textContent = '图片压缩 / 使用说明';
      const title = document.createElement('h1'); title.textContent = spec.title;
      const subtitle = document.createElement('p'); subtitle.textContent = spec.subtitle;
      const number = document.createElement('div'); number.className = 'guide-page-number'; number.textContent = spec.number + ' / 06';
      heading.append(eyebrow, title, subtitle, number); overlay.append(heading);
      const notes = document.createElement('aside'); notes.className = 'guide-notes';
      spec.notes.forEach(([title, text], index) => {
        const card = document.createElement('section'); card.className = 'guide-note';
        const h = document.createElement('h2'), badge = document.createElement('b'); badge.textContent = String(index + 1); h.append(badge, title);
        const p = document.createElement('p'); p.textContent = text; card.append(h, p); notes.append(card);
      }); overlay.append(notes);
      const footer = document.createElement('footer'); footer.className = 'guide-footer';
      const left = document.createElement('span'); left.textContent = 'sy-imgcompression · 思源笔记桌面插件';
      const right = document.createElement('span'); right.textContent = '示例文档 / 本地离线处理'; footer.append(left, right); overlay.append(footer); document.body.append(overlay);
      const dialogs = window.__dialogs.filter(dialog => dialog.element.isConnected);
      dialogs.forEach((dialog, index) => {
        const top = index === dialogs.length - 1;
        dialog.element.style.visibility = top ? 'visible' : 'hidden';
        dialog.element.style.cssText += 'position:fixed;top:206px;left:' + (spec.compact ? '226px' : '48px') + ';width:' + (spec.compact ? '720px' : '1100px') + ';height:' + (spec.compact ? 'auto' : '916px') + ';max-height:916px;transform:none;margin:0;box-shadow:0 12px 45px #243e6712;z-index:100;';
      });
    }, { spec, css: guideCSS });
  }
  async function capture(spec, pins) {
    await frame(spec);
    for (let index = 0; index < pins.length; index++) {
      const target = pins[index]; const box = await target.boundingBox();
      assert(box && box.y >= 200 && box.y < 1120, `Guide pin ${index + 1} is offscreen: ${spec.file}`);
      await page.evaluate(({ x, y, number }) => {
        const pin = document.createElement('span'); pin.className = 'guide-pin guide-layer'; pin.textContent = String(number);
        pin.style.left = x + 'px'; pin.style.top = y + 'px'; document.body.append(pin);
      }, { x: Math.min(1120, box.x + box.width - 12), y: Math.max(196, box.y - 11), number: index + 1 });
    }
    await page.screenshot({ path: path.join(output, spec.file), fullPage: false, animations: 'disabled' });
    manifest.push({ file: spec.file, title: spec.title, notes: spec.notes, width: 1600, height: 1200 });
    console.log('GUIDE ' + spec.file);
  }
  const main = page.locator('.sy-imgcompression-root');
  const revealMain = async () => { await page.evaluate(() => { const root = document.querySelector('.sy-imgcompression-root'); if (root) { root.closest('section').style.visibility = 'visible'; root.closest('section').style.zIndex = '10'; } }); };
  await frame({ number: '01', title: '', subtitle: '', notes: [] });
  await main.evaluate(node => { node.scrollTop = 0; });
  await capture({ number: '01', file: '01-batch-compression.png', title: '批量压缩，从当前文档开始', subtitle: '扫描图片，选择预设与尺寸，再应用到勾选项。', notes: [
    ['选择压缩参数', '默认采用均衡预设。可以保持原尺寸，也可以按比例缩小，始终保持宽高比。'],
    ['先看附件总大小', '统计包含当前文档的全部本地附件；同一路径只计一次，不随筛选和勾选改变。'],
    ['勾选后再应用', '只处理选中的静态 JPEG、PNG、WebP。没有变小的压缩结果会自动跳过。'],
  ] }, [main.locator('.syic-global-profile'), main.locator('.syic-total'), main.getByRole('button', { name: '应用到选中附件', exact: true })]);

  await main.getByRole('button', { name: '单独设置', exact: true }).first().click();
  let child = page.locator('.syic-child');
  await child.getByLabel('缩放方式', { exact: true }).selectOption('50');
  await child.getByLabel('质量', { exact: true }).fill('78'); await child.getByLabel('质量', { exact: true }).blur();
  await child.locator('.syic-original').evaluate(image => image.decode());
  await capture({ number: '02', file: '02-individual-settings.png', title: '每张图片，都可以单独设置', subtitle: '不同图片使用不同参数，不必反复拆成多次批量任务。', notes: [
    ['设置当前图片', '质量、格式、比例或像素限制均可单独调整。示例将封面缩小到 50%。'],
    ['保存独立配置', '保存后该图片不再继承全局参数。其他未单独设置的图片仍跟随全局配置。'],
    ['核对预计尺寸', '上方显示原尺寸与预计输出尺寸。缩放始终保持比例、不放大；保存后可在列表中恢复继承。'],
  ] }, [child.locator('.syic-profile'), child.getByRole('button', { name: '保存配置', exact: true }), child.locator('.syic-expected')]);
  await child.getByRole('button', { name: '保存配置', exact: true }).click();
  await revealMain();

  await main.getByRole('button', { name: '预览', exact: true }).first().click(); child = page.locator('.syic-child');
  await frame({ number: '03', title: '', subtitle: '', notes: [] });
  await child.getByRole('button', { name: '生成压缩预览', exact: true }).click();
  await child.locator('.syic-preview img').nth(1).waitFor();
  await child.locator('.syic-preview img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await frame({ number: '03', title: '', subtitle: '', notes: [] });
  await child.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await capture({ number: '03', file: '03-compression-preview.png', title: '先看压缩对比，再决定应用', subtitle: '预览在独立子面板中完成，查看原图本身不会触发压缩。', notes: [
    ['点击才生成预览', '只有点击“生成压缩预览”才运行压缩。调整参数后，需要再次点击重新生成。'],
    ['对比尺寸和体积', '同时查看原图与压缩结果，核对输出尺寸、文件大小以及本次文件缩减量。'],
    ['预览不会替换引用', '确认效果后，回到主面板点击“应用到选中附件”，才会写入新文件并更新引用。'],
  ] }, [child.getByRole('button', { name: '生成压缩预览', exact: true }), child.locator('.syic-preview-state'), child.locator('.syic-preview figure').last()]);
  await page.evaluate(() => window.__dialogs.at(-1).destroy());
  await revealMain();
  await main.getByRole('button', { name: '扫描当前文档', exact: true }).click(); await ready();

  await main.getByRole('tab', { name: '图片重命名', exact: true }).click();
  await main.getByLabel('批量命名前缀', { exact: true }).fill('项目'); await main.getByLabel('批量命名前缀', { exact: true }).blur();
  await main.getByLabel('单独名称: ' + assets[0][0], { exact: true }).fill('封面'); await main.getByLabel('单独名称: ' + assets[0][0], { exact: true }).blur();
  await main.getByLabel('文件类型', { exact: true }).selectOption('images');
  await main.evaluate(node => { node.scrollTop = 0; });
  await capture({ number: '04', file: '04-custom-names.png', title: '统一前缀，也能逐张命名', subtitle: '只输入名称部分，思源 ID 和原扩展名会自动保留。', notes: [
    ['设置批量前缀', '默认前缀是 image。示例改为“项目”，未单独命名的图片统一使用这个前缀。'],
    ['给重点图片单独命名', '在每行名称框填写“封面”等名称。单独名称会覆盖批量前缀，且不随前缀修改而变化。'],
    ['核对最终完整名称', '输入框下方展示最终文件名。清空单独名称或点击“使用批量前缀”即可恢复继承。'],
  ] }, [main.getByLabel('批量命名前缀', { exact: true }), main.getByLabel('单独名称: ' + assets[0][0], { exact: true }), main.locator('.syic-rename-target').first()]);

  await page.evaluate(({ id, asset }) => {
    window.__dialogs.find(dialog => dialog.element.querySelector('.sy-imgcompression-root'))?.destroy();
    const image = document.createElement('img'); image.src = '/assets/' + asset; const items = [];
    window.__events['open-menu-image']({ detail: { menu: { addItem: item => items.push(item) }, element: image, protyle: { block: { rootID: id }, disabled: false } } });
    items.find(item => item.label === '快捷压缩配置').click();
  }, { id: documentId, asset: assets[0][0] });
  child = page.locator('.syic-quick-settings'); await child.getByLabel('缩放方式', { exact: true }).selectOption('75');
  await capture({ number: '05', compact: true, file: '05-quick-compression.png', title: '右键快捷压缩，配置独立保存', subtitle: '先保存常用参数，之后右键点“快捷压缩”即可直接执行。', notes: [
    ['独立的选项框', '图片右键菜单和主面板都能打开“快捷压缩配置”，无需先进入附件列表。'],
    ['保存常用参数', '这里的设置与批量压缩面板分开保存。示例使用均衡、WebP 和 75% 尺寸。'],
    ['选择常用尺寸', '比例和像素限制都保持宽高比。保存后右键“快捷压缩”会直接执行，并写入任务记录。'],
  ] }, [child.locator('.syic-settings-box'), child.getByRole('button', { name: '保存配置', exact: true }), child.getByLabel('缩放方式', { exact: true })]);
  await child.getByRole('button', { name: '保存配置', exact: true }).click();

  await page.evaluate(() => window.__open()); await ready();
  await main.getByRole('button', { name: '应用到选中附件', exact: true }).click();
  await page.waitForFunction(() => { const job = JSON.parse(localStorage.getItem('jobs.json') || '{"jobs":[]}').jobs[0]; return job?.state === 'completed' && !document.querySelector('.syic-actions button')?.disabled; }, null, { timeout: 120000 });
  const firstJob = main.locator('.syic-history > details').first(); await firstJob.locator('summary').click();
  await frame({ number: '06', title: '', subtitle: '', notes: [] }); await main.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await capture({ number: '06', file: '06-history-recovery.png', title: '处理有记录，引用可以恢复', subtitle: '原附件保留用于恢复；文件缩减量不等于工作空间立即释放的磁盘空间。', notes: [
    ['核对每项任务结果', '任务记录列出原路径、新路径及完成、跳过或失败状态，便于逐项确认。'],
    ['恢复仍匹配的引用', '点击恢复按钮前会核验文件及引用。出现后续编辑或新增引用时，会阻止冲突恢复。'],
    ['原附件不会自动删除', '保留原文件，才能在需要时恢复。确认无需恢复后，可在思源中检查并清理未引用附件。'],
  ] }, [firstJob.locator('summary'), firstJob.getByRole('button', { name: '恢复仍匹配的引用', exact: true }), firstJob.locator('.syic-job-item').first()]);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ source: 'Production plugin + isolated SiYuan kernel + browser host adapter; annotations added in the capture page.', documentId, images: manifest }, null, 2));
  assert.equal(manifest.length, 6); console.log('Created all 6 usage illustrations in ' + output);
}
