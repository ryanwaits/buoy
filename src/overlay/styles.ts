/**
 * Shadow-root stylesheet. Chrome is neutral: black, white, grey. A buoy takes the
 * host page's own ink; the one colour Buoy brings is the wash behind the word that is wrong.
 * Hosts can pin `--buoy-ink`, `--buoy-paper` and `--buoy-mark`.
 */
export const STYLES: string = /* css */ `
:host{
  --ink:var(--buoy-ink,var(--auto-ink,#1a1a1a));--paper:var(--buoy-paper,var(--auto-paper,#fff));--mark:var(--buoy-mark,#ffcc00);
  --ui:#fff;--tx:rgba(0,0,0,.85);--tx2:rgba(0,0,0,.5);--tx3:rgba(0,0,0,.4);--fill:rgba(0,0,0,.03);--hover:rgba(0,0,0,.06);--held:rgba(0,0,0,.08);
  --line:rgba(0,0,0,.12);--hair:rgba(0,0,0,.07);--solid:#1a1a1a;--on-solid:#fff;--key:#7c3aed;--wash:38%;--blend:multiply;
  --bar-shadow:0 2px 8px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04);
  --panel-shadow:0 1px 8px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.05);
  --pop-shadow:0 4px 24px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);
  --out:cubic-bezier(.22,1,.36,1);--expo:cubic-bezier(.19,1,.22,1);--back:cubic-bezier(.34,1.56,.64,1);
  all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;
  font:13px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
:host([data-theme="dark"]){
  --ui:#1a1a1a;--tx:rgba(255,255,255,.92);--tx2:rgba(255,255,255,.6);--tx3:rgba(255,255,255,.4);--fill:rgba(255,255,255,.06);--hover:rgba(255,255,255,.1);--held:rgba(255,255,255,.14);
  --line:rgba(255,255,255,.15);--hair:rgba(255,255,255,.08);--solid:#fff;--on-solid:#1a1a1a;--key:#a78bfa;--wash:30%;--blend:normal;
  --bar-shadow:0 2px 8px rgba(0,0,0,.2),0 4px 16px rgba(0,0,0,.1),0 0 0 1px rgba(255,255,255,.06);
  --panel-shadow:0 1px 8px rgba(0,0,0,.25),0 0 0 1px rgba(255,255,255,.08);
  --pop-shadow:0 4px 24px rgba(0,0,0,.3),0 0 0 1px rgba(255,255,255,.08);
}
*{box-sizing:border-box}
button,textarea{font:inherit;color:inherit}
button{cursor:pointer;background:none;border:0;padding:0}
code,.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
:focus-visible{outline:2px solid var(--solid);outline-offset:3px}

.layer{position:absolute;top:0;left:0}
.layer.off{display:none}

.navlayer{position:fixed;top:0;left:0;pointer-events:none}
.nd{position:absolute;display:flex;align-items:center;gap:3px;transform:translateY(-50%);animation:fade .2s ease-out both}
.nd i{width:5px;height:5px;border-radius:50%;background:var(--ink);opacity:.8}
.nd b{margin-left:1px;font:600 10.5px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:var(--ink);opacity:.8}
.nd[hidden]{display:none}
@keyframes fade{from{opacity:0}}

.hl{position:absolute;border-radius:3px;pointer-events:none;mix-blend-mode:var(--blend);background:color-mix(in srgb,var(--mark) var(--wash),transparent);opacity:0;transition:opacity .12s ease-out}
.hl.token,.hl.on{opacity:1}
.leave .hl{opacity:0}

.ring{position:absolute;border-radius:10px;pointer-events:none;border:1.5px solid color-mix(in srgb,var(--ink) 40%,transparent);background:color-mix(in srgb,var(--ink) 4%,transparent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--paper) 70%,transparent);opacity:0;transition:opacity .12s ease-out}
.ring.on{opacity:1}
.leave .ring{opacity:0}

.gapline{position:absolute;cursor:pointer}
.gapline::before{content:"";position:absolute;left:0;right:6px;top:50%;border-top:1px dashed var(--ink);opacity:.35;
  transform-origin:right;transition:opacity .12s ease-out;animation:lineIn .3s var(--out) both;animation-delay:calc(var(--i)*45ms)}
.gapline:hover::before,.gapline.on::before{opacity:.9}
.leave .gapline::before{opacity:0}
@keyframes lineIn{from{transform:scaleX(0);opacity:0}}

.pin{position:absolute;z-index:1;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--ink);color:var(--paper);
  font:600 11px/22px system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums;
  box-shadow:0 2px 6px rgba(0,0,0,.2),inset 0 0 0 1px rgba(0,0,0,.04);transition:transform .1s,box-shadow .15s;
  animation:pinIn .25s var(--out) both;animation-delay:calc(var(--i)*45ms)}
.pin::after{content:"";position:absolute;inset:-11px}
.pin:hover{transform:scale(1.1)}
.pin.on{box-shadow:0 2px 6px rgba(0,0,0,.2),0 0 0 2px var(--paper),0 0 0 4px var(--ink)}
/* Resolved: the same solid buoy, the tick in place of the count. */
.pin.done{opacity:.85}
.pin.done svg{vertical-align:-1px}
.pin.exit,.leave .pin{animation:pinOut .2s ease-out both}
@keyframes pinIn{from{opacity:0;transform:scale(.3)}}
@keyframes pinOut{to{opacity:0;transform:scale(.3)}}

.pop{position:absolute;z-index:2;width:min(320px,calc(100vw - 32px));background:var(--ui);color:var(--tx);border-radius:16px;
  padding:12px 16px 14px;display:grid;gap:10px;box-shadow:var(--pop-shadow);transform-origin:var(--ox,100%) 0;animation:popIn .2s var(--back) both}
.pop:focus{outline:none}
.pop.exit{animation:popOut .15s ease-in both;pointer-events:none}
@keyframes popIn{from{opacity:0;transform:scale(.95) translateY(4px)}}
@keyframes popOut{to{opacity:0;transform:scale(.95) translateY(4px)}}
.pop-h{display:flex;align-items:baseline;gap:8px;font-size:12px;color:var(--tx2)}
.pop-h b{font-weight:600;color:var(--tx)}
.pop-h i{margin-left:auto;font-style:normal;color:var(--tx3);font-variant-numeric:tabular-nums}
.say{margin:0;font-weight:500;font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.say code,.lost code{font-size:12.5px;border-radius:4px;padding:1px 4px;background:var(--fill)}
.say code.w{background:color-mix(in srgb,var(--mark) var(--wash),transparent)}
.says{list-style:none;margin:0;padding:0;display:grid;gap:6px;max-height:240px;overflow-y:auto}
.says li{display:grid;grid-template-columns:5px minmax(0,1fr) auto;gap:8px;align-items:baseline}
.says li::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--tx);transform:translateY(-2px)}
.says button{color:var(--tx3);font-size:12px}
.says button:hover{color:var(--tx)}
.facts{margin:0;padding:9px 11px;border-radius:8px;background:var(--fill);display:grid;grid-template-columns:48px minmax(0,1fr);gap:2px 10px;font-size:12px;line-height:1.6}
.facts dt{color:var(--key)}
.facts dd{margin:0;overflow-wrap:anywhere}
.facts mark{color:inherit;border-radius:3px;padding:0 2px;background:color-mix(in srgb,var(--mark) var(--wash),transparent)}
.facts .dim{color:var(--tx3)}
.where{margin-left:auto;color:var(--tx3);font-variant-numeric:tabular-nums}
.where:hover{color:var(--tx)}
.views{overflow:hidden;transition:height .3s var(--expo)}
.track{display:flex;align-items:flex-start;transition:transform .3s var(--expo)}
.panel-in{flex:0 0 100%;min-width:0;display:grid;gap:10px;align-content:start}
.rows{display:grid;gap:2px;padding:4px;border-radius:8px;background:var(--fill)}
.rowbtn{display:grid;grid-template-columns:48px minmax(0,1fr) 14px;gap:10px;align-items:baseline;text-align:left;border-radius:6px;padding:5px 7px;font-size:12px;line-height:1.6;color:var(--tx)}
.rowbtn:hover{background:var(--hover)}
.rowbtn .k{color:var(--key)}
.rowbtn .v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rowbtn .c{color:var(--tx3)}
.back{display:inline-flex;align-items:center;gap:4px;padding:2px 6px 2px 2px;margin-left:-4px;border-radius:8px;color:var(--tx2);font-size:12px}
.back:hover{background:var(--hover);color:var(--tx)}
.crumb{font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crumb span{font-weight:400;color:var(--key)}
.members{padding:8px 11px;border-radius:8px;background:var(--fill);display:grid;gap:3px;font-size:12px;line-height:1.6}
.members code{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.members b{font-weight:500;color:var(--tx)}
.members span{color:var(--tx3)}
.members i{margin-left:8px;font:500 10.5px/1 system-ui,sans-serif;font-style:normal;color:var(--tx3)}
.members code.bad{text-decoration:line-through;text-decoration-color:var(--tx3)}
.members code.bad span{text-decoration:none;display:inline-block}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11.5px;line-height:1.5;color:var(--tx2)}
.meta .path{color:var(--tx);overflow-wrap:anywhere}
.quote{margin:0;padding:8px 10px;border-radius:8px;background:var(--fill);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.quote mark{color:inherit;border-radius:3px;padding:0 2px;background:color-mix(in srgb,var(--mark) var(--wash),transparent)}
.cap{margin:0;font-size:11.5px;line-height:1.4;color:var(--tx3)}
.tbl{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:3px 10px;padding:9px 11px;border-radius:8px;background:var(--fill);font-size:12px;line-height:1.6}
.tbl .t{color:var(--tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbl .f{font-size:10.5px;color:var(--tx3);text-align:right;white-space:nowrap}
.tbl .bad{text-decoration:line-through;text-decoration-color:var(--tx3)}
.tbl .warn{font-weight:600}
.code{margin:0;padding:8px 0;border-radius:8px;background:var(--fill);font-size:11.5px;line-height:1.65;overflow-x:auto}
.code div{display:grid;grid-template-columns:34px max-content;white-space:pre;padding-right:10px;min-width:100%}
.code div>span:first-child{color:var(--tx3);text-align:right;padding-right:10px;user-select:none}
.code .hit{background:color-mix(in srgb,var(--mark) 28%,transparent)}
.mini{border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;color:var(--tx2)}
.mini:hover{color:var(--tx);border-color:var(--tx2)}
.bar{display:grid;grid-template-columns:78px minmax(0,1fr) 30px;gap:8px;align-items:center;font-size:12px}
.bar i{display:block;height:6px;border-radius:3px;background:var(--fill);overflow:hidden}
.bar i b{display:block;height:100%;border-radius:3px;background:var(--tx)}
.bar span:last-child{text-align:right;color:var(--tx2);font-variant-numeric:tabular-nums}
.fold{display:grid;grid-template-rows:0fr;margin-top:-10px;transition:grid-template-rows .22s var(--out),margin-top .22s var(--out)}
.fold>div{overflow:hidden;min-height:0;display:grid;gap:10px}
.fold.open{grid-template-rows:1fr;margin-top:0}
.pop.open .trimmed,.pop:has(.fold.open) .trimmed{display:none}
.more{flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;min-height:30px;margin-right:auto;font-size:12px;color:var(--tx2)}
.more:hover{color:var(--tx)}
.more svg{transition:transform .22s var(--out)}
.more[aria-expanded="true"] svg{transform:rotate(180deg)}
.note{display:block;width:100%;min-height:44px;padding:8px 10px;border-radius:8px;background:var(--fill);border:1px solid var(--line);font-size:13px;line-height:1.4;resize:none;transition:border-color .15s}
.said{padding:8px 10px;border-radius:8px;background:var(--fill);font-size:12.5px;color:var(--tx2);display:grid;gap:2px}
.said b{color:var(--tx);font-weight:600}
.said span{overflow-wrap:anywhere}
.said button{justify-self:start;font-size:12px;color:var(--tx3);text-decoration:underline}
.said button:hover{color:var(--tx)}
.note::placeholder{color:var(--tx3)}
.note:focus{outline:none;border-color:var(--tx2)}
.pop-f{display:flex;align-items:center;justify-content:flex-end;gap:4px}
.pill{flex:none;white-space:nowrap;min-height:30px;padding:6px 14px;border-radius:16px;font-weight:500;font-size:12px;color:var(--tx2);transition:background-color .15s,color .15s}
.pill:hover{color:var(--tx);background:var(--hover)}
.pill.go{background:var(--solid);color:var(--on-solid)}
.pill.go:hover{opacity:.88}

.dock{position:fixed;right:20px;bottom:calc(20px + env(safe-area-inset-bottom,0px));transition:opacity .15s}
.dock.up{z-index:3}
.bar{position:relative;width:44px;height:44px;border-radius:22px;background:var(--ui);color:var(--tx2);box-shadow:var(--bar-shadow);transition:width .36s var(--expo)}
.bar.open{width:var(--w,260px)}
.bar-ic,.bar-in{position:absolute;top:0;right:0;height:44px;transition:opacity .15s,visibility 0s .15s}
.bar-ic{width:44px;display:grid;place-items:center;border-radius:22px;color:var(--tx)}
.bar-ic:hover{background:var(--hover)}
.bar-in{display:flex;align-items:center;gap:6px;padding:5px;white-space:nowrap;opacity:0;visibility:hidden}
.bar.open .bar-in{opacity:1;visibility:visible;transition:opacity .2s .1s,visibility 0s}
.bar.open .bar-ic{opacity:0;visibility:hidden}
.bar svg{display:block}
.cb{position:relative;width:34px;height:34px;border-radius:17px;display:grid;place-items:center;flex:none;transition:background-color .15s,color .15s}
.cb:hover{background:var(--hover);color:var(--tx)}
.cb[aria-expanded="true"],.cb[data-held]{background:var(--held);color:var(--tx)}
.cb:disabled{opacity:.35;cursor:default;background:none;color:inherit}
.cb.done{color:var(--tx)}
.cb.next{width:auto;display:flex;align-items:center;gap:2px;padding:0 6px 0 12px;font-weight:600;font-size:13px;color:var(--tx);font-variant-numeric:tabular-nums}
.cb.next svg{opacity:.55}
.cb.next.quiet{padding:0 12px;font-weight:500;color:var(--tx2)}
.cb .ct{position:absolute;top:1px;right:0;min-width:14px;height:14px;padding:0 4px;border-radius:7px;background:var(--solid);color:var(--on-solid);font:600 9.5px/14px system-ui,sans-serif;font-variant-numeric:tabular-nums}
.bar hr{width:1px;height:12px;border:0;margin:0 2px;background:var(--line)}
[data-tip]::before,[data-tip]::after{position:absolute;left:50%;opacity:0;pointer-events:none;transition:opacity .135s ease-out}
[data-tip]::after{content:attr(data-tip) "  " attr(data-key);bottom:calc(100% + 14px);transform:translateX(-50%);padding:6px 10px;border-radius:8px;background:var(--ui);color:var(--tx);
  font:500 12px/1.2 system-ui,sans-serif;white-space:pre;box-shadow:var(--bar-shadow)}
[data-tip]::before{content:"";bottom:calc(100% + 10px);width:8px;height:8px;transform:translateX(-50%) rotate(45deg);background:var(--ui);z-index:1}
[data-tip]:hover::before,[data-tip]:hover::after,[data-tip]:focus-visible::before,[data-tip]:focus-visible::after{opacity:1}
[aria-expanded="true"][data-tip]::before,[aria-expanded="true"][data-tip]::after{opacity:0}
.badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--solid);color:var(--on-solid);
  font:600 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px var(--ui);transition:transform .3s var(--out),opacity .2s;pointer-events:none}
.open+.badge,.badge:empty{transform:scale(0);opacity:0}

.panel{position:absolute;right:0;bottom:52px;width:min(300px,calc(100vw - 32px));max-height:min(70vh,520px);overflow-y:auto;background:var(--ui);color:var(--tx);
  border-radius:16px;box-shadow:var(--panel-shadow);font-size:13.5px;transform-origin:100% 100%;animation:popIn .2s var(--out) both}
.panel:focus{outline:none}
.panel header{padding:16px 16px 10px;display:grid;gap:4px}
.panel header b{font-weight:600;font-size:14px}
.panel header span{font-size:12.5px;color:var(--tx3)}
.grp{margin:0;padding:10px 16px 6px;font-weight:500;font-size:11.5px;color:var(--tx3)}
.opt{display:flex;align-items:center;gap:10px;width:100%;padding:7px 16px;text-align:left;text-decoration:none;color:inherit}
.opt:hover{background:var(--fill)}
.opt.cur{background:var(--hover)}
.opt small{font-size:12px;color:var(--tx3)}
.opt .n{margin-left:auto;font-weight:500;font-size:12px;color:var(--tx3);font-variant-numeric:tabular-nums}
.opt.dim{color:var(--tx3)}
.chk{width:16px;height:16px;border-radius:5px;flex:none;display:grid;place-items:center;background:var(--solid);color:var(--on-solid)}
[aria-checked="false"] .chk{background:transparent;box-shadow:inset 0 0 0 1.5px var(--line)}
[aria-checked="false"] .chk svg{display:none}
.opt.gone{align-items:flex-start;justify-content:space-between;padding-block:8px}
.opt.gone>span{display:grid;gap:2px;min-width:0}
.opt.gone .say{font-weight:400;font-size:13px}
.opt.gone button{flex:none;font-weight:500;font-size:12px;color:var(--tx2);padding:2px 0}
.opt.gone button:hover{color:var(--tx)}
.lost{list-style:none;margin:0;padding:0 16px 4px;display:grid;gap:10px}
.lost li{display:grid;gap:2px}
.lost p{margin:0}
.lost small{font-size:11.5px;color:var(--tx3);overflow-wrap:anywhere}
.panel footer{display:flex;justify-content:space-between;margin-top:8px;padding:12px 16px;border-top:1px solid var(--hair);font-size:13px;color:var(--tx3)}
.panel footer button:hover{color:var(--tx)}

@media (max-width:760px){
  .dock{right:16px}
  .dock.away{opacity:0;pointer-events:none}
  .pill{min-height:40px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}}
`;
