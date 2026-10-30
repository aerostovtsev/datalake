async (page) => {
  const base = new URL('/', page.url()).href;
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1200, height: 823 } });
  const p = await context.newPage();
  const errors = [], failures = [], results = [];
  p.on('pageerror', error => errors.push(error.message));
  p.on('response', response => { if (response.status() >= 400) failures.push([response.status(), response.url()]); });
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    const response = await p.goto(base);
    check(response.status() === 200, 'Homepage must return HTTP 200');
    await p.evaluate(() => document.fonts.ready);
    const intact = await p.evaluate(() => ({
      command: document.querySelector('#command-cc').textContent,
      title: document.querySelector('#install h2').textContent,
      stats: [...document.querySelectorAll('#tools .stats b')].map(e => e.textContent),
      widths: [...document.querySelectorAll('#chart .bar')].map(e => e.style.getPropertyValue('--w'))
    }));
    check(intact.command.startsWith('claude mcp add'), 'Command missing before scrolling');
    check(intact.title.includes('Одна команда.'), 'Heading corrupted before scrolling');
    check(JSON.stringify(intact.stats) === JSON.stringify(['14', '12', '8']), 'Stats must retain final values');
    check(intact.widths.every(v => parseFloat(v) > 0), 'Chart must retain visible bars');
    results.push({ test: 'content-before-scroll', passed: true });

    const responsive = [];
    for (const [width, height] of [[320,480],[320,568],[375,667],[390,844],[640,360],[667,300],[768,1024],[860,768],[861,768],[900,600],[901,600],[1024,768],[1200,823],[1440,900]]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(170);
      const dimensions = await p.evaluate(() => ({
        viewport: innerWidth,
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      }));
      check(dimensions.scroll <= dimensions.client + 1, 'Horizontal overflow: ' + JSON.stringify(dimensions));
      responsive.push({ width, height, ...dimensions });
    }
    results.push({ test: 'responsive-layout', passed: true, dimensions: responsive });

    await p.setViewportSize({width:320,height:480});
    await p.goto(base + '#install');
    await p.waitForTimeout(300);
    check((await p.locator('#command-cc').innerText()).startsWith('claude mcp add'), 'Short viewport command is empty');
    results.push({ test: 'short-viewport-instructions', passed: true });

    await p.setViewportSize({width:375,height:667});
    await p.getByRole('button', {name:'Меню',exact:true}).click();
    check(await p.locator('#navlinks').evaluate(el => el.matches(':popover-open')), 'Menu did not open');
    await p.getByRole('link', {name:'Подключение',exact:true}).click();
    check(!(await p.locator('#navlinks').evaluate(el => el.matches(':popover-open'))), 'Menu stayed open');
    results.push({ test: 'mobile-menu-closes', passed: true });

    const cc = p.getByRole('tab', {name:'Claude Code',exact:true});
    await cc.focus();
    for (const [key, expected] of [['ArrowRight','Codex CLI'],['End','Cursor · Desktop · ChatGPT'],['ArrowRight','Claude Code'],['ArrowLeft','Cursor · Desktop · ChatGPT'],['Home','Claude Code']]) {
      await p.keyboard.press(key);
      check(await p.getByRole('tab', {selected:true}).innerText() === expected, 'Tab key failed: ' + key);
      check(await p.evaluate(() => document.activeElement.getAttribute('aria-selected')) === 'true', 'Tab focus is wrong');
    }
    check(await p.locator('[role=tab][tabindex="0"]').count() === 1, 'Only selected tab should have tabindex 0');
    check(await p.getByRole('tabpanel').count() === 1, 'Exactly one tab panel should be accessible');
    results.push({ test: 'keyboard-tabs', passed: true });

    await p.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {configurable:true,value:async text => {window.__copied = text;}}));
    const copies = [];
    for (const name of ['Claude Code','Codex CLI','OpenCode','Cursor · Desktop · ChatGPT']) {
      await p.getByRole('tab', {name,exact:true}).click();
      const buttons = p.getByRole('tabpanel').locator('.copy');
      for (let i=0;i<await buttons.count();i++) {
        const button = buttons.nth(i), target = await button.getAttribute('data-copy');
        const expected = (await p.locator('#'+target).textContent()).trim();
        await button.click();
        check(await p.evaluate(() => window.__copied) === expected, 'Clipboard mismatch for '+target);
        if (target === 'config-opencode') check(JSON.parse(expected).mcp.datalake.type === 'remote', 'OpenCode JSON invalid');
        if (target === 'command-opencode') check(expected === 'opencode mcp auth datalake', 'OpenCode shell command mixed with JSON');
        copies.push(target);
      }
    }
    await cc.click();
    await p.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {configurable:true,value:async () => {throw new Error('denied');}}));
    await p.locator('[data-copy=command-cc]').click();
    check(await p.evaluate(() => getSelection().toString()) === (await p.locator('#command-cc').textContent()), 'Clipboard fallback did not select full command');
    results.push({ test: 'clipboard-success-and-denial', passed: true, copies });

    const semantics = await p.locator('main').ariaSnapshot();
    check(!semantics.includes('WITH ask AS'), 'Decorative SQL exposed to accessibility tree');
    check(await p.getByRole('table').getByRole('row').count() === 12, 'Table rows missing');
    check(await p.getByRole('table').getByRole('columnheader').count() === 2, 'Table column headers missing');
    check(await p.getByRole('table').getByRole('cell').count() === 22, 'Table cells missing');
    results.push({ test: 'accessibility-tree', passed: true });
    const contrast = await p.evaluate(() => {
      const rgb = value => value.match(/\d+/g).slice(0,3).map(Number);
      const lum = values => values.map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const bg=lum(rgb(getComputedStyle(document.body).backgroundColor));
      return [...document.querySelectorAll('#install .fine,.switch button')].map(el=>{
        const fg=lum(rgb(getComputedStyle(el).color));return {text:el.textContent.slice(0,20),ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};
      });
    });
    check(contrast.every(item => item.ratio >= 4.5), 'Text contrast below 4.5:1');
    results.push({test:'text-contrast',passed:true,contrast});

    await p.setViewportSize({width:1200,height:823});
    await p.goto(base);
    await p.emulateMedia({media:'print'});
    const print = await p.evaluate(() => ({
      stats:[...document.querySelectorAll('#tools .stats b')].map(e=>e.textContent),
      commands:[...document.querySelectorAll('.cmd pre')].map(e=>({text:e.textContent,visible:e.getBoundingClientRect().height>0})),
      heading:document.querySelector('#install h2').textContent
    }));
    check(print.commands.every(c=>c.visible&&c.text.trim()), 'Printed commands missing');
    check(print.stats.join(',') === '14,12,8' && print.heading.includes('Одна команда.'), 'Print contains animation placeholders');
    results.push({test:'print-before-scroll',passed:true});
    await p.emulateMedia({media:'screen'});
    const docResponse = await p.goto(new URL('connect.html',base).href);
    check(docResponse.status() === 200 && await p.getByRole('heading',{name:'Подключение к datalake',exact:true}).count()===1, 'Documentation link broken');
    results.push({test:'documentation-link',passed:true});

    await p.addInitScript(() => {
      window.__rafCount=0;
      const raf=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=callback=>raf(time=>{window.__rafCount++;callback(time);});
    });
    await p.goto(base);
    await p.waitForTimeout(400);
    await p.getByRole('button',{name:'Остановить движение'}).click();
    await p.waitForTimeout(100);
    const paused=await p.evaluate(()=>window.__rafCount);
    await p.waitForTimeout(400);
    check(await p.evaluate(()=>window.__rafCount) === paused, 'Animation frames continue while paused');
    await p.getByRole('button',{name:'Пустить движение'}).click();
    await p.waitForTimeout(150);
    check(await p.evaluate(()=>window.__rafCount) > paused, 'Animation failed to resume');
    await p.evaluate(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'instant'}));
    await p.waitForTimeout(150);
    const offscreen=await p.evaluate(()=>window.__rafCount);
    await p.waitForTimeout(400);
    check(await p.evaluate(()=>window.__rafCount) === offscreen, 'Animation frames continue offscreen');
    await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await p.waitForTimeout(150);
    await p.emulateMedia({reducedMotion:'reduce'});
    await p.waitForTimeout(150);
    const reduced=await p.evaluate(()=>window.__rafCount);
    await p.waitForTimeout(400);
    check(await p.evaluate(()=>window.__rafCount) === reduced, 'Runtime reduced motion did not stop animation');
    results.push({test:'animation-pause-resume-offscreen-reduced-motion',passed:true});

    await p.emulateMedia({reducedMotion:'no-preference'});
    await p.setViewportSize({width:320,height:568});
    await p.goto(base+'#tools');
    await p.evaluate(()=>document.querySelector('#tools').scrollIntoView({behavior:'instant'}));
    await p.waitForTimeout(170);
    await p.screenshot({path:'output/playwright/datalake-fixed-320.png'});
    await p.setViewportSize({width:1200,height:823});
    await p.goto(base);
    await p.screenshot({path:'output/playwright/datalake-fixed-desktop.png'});
    check(errors.length === 0, 'JavaScript errors: '+JSON.stringify(errors));
    check(failures.length === 0, 'HTTP errors: '+JSON.stringify(failures));
    results.push({test:'console-and-network',passed:true,errors,failures});
    const nojs = await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:480}});
    try {
      const staticPage=await nojs.newPage();await staticPage.goto(base);
      check(await staticPage.locator('#command-cc').isVisible(), 'No-JS first command missing');
      check(await staticPage.locator('#config-opencode').isVisible(), 'No-JS OpenCode config missing');
      check(await staticPage.locator('#connector-url').isVisible(), 'No-JS connector settings missing');
      check(await staticPage.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1), 'No-JS overflow');
      results.push({test:'javascript-disabled',passed:true});
    } finally { await nojs.close(); }
    return {base,passed:results.length,results};
  } finally { await context.close(); }
}
