const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('nextCanvas');
const nextCtx = nextCanvas.getContext('2d');
const next2Canvas = document.getElementById('next2Canvas');
const next2Ctx = next2Canvas.getContext('2d');
const popupRoot = document.getElementById('popupRoot');

const pauseOverlay = document.getElementById('pauseOverlay');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');

const COLS = 6;
const VISIBLE_ROWS = 12;
const HIDDEN_ROWS = 1;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const CELL = 60;

const COLORS = { R:'#ff4d4d', G:'#4cd964', B:'#368cff', Y:'#ffd24d', P:'#b46cff' };
const COLOR_KEYS = Object.keys(COLORS);

let board = createBoard(ROWS, COLS);
let active = null;
let nextQueue = [];
let score = 0, chainDisplay = 0, totalCleared = 0;
let dropTimer = 0, dropInterval = 700;
let lastTime = 0, gameOver = false, ghostOn = true;
let popAnimations = [];
let chainPopEffects = [];
let resolving = false;

let paused = false;

canvas.width = COLS * CELL;
canvas.height = VISIBLE_ROWS * CELL;

init();

/* ---------- util ---------- */
function createBoard(r,c){ return Array.from({length:r},()=>Array(c).fill(null)); }
function randColor(){ return COLOR_KEYS[Math.floor(Math.random()*COLOR_KEYS.length)]; }
function randPiece(){ return {a:randColor(), b:randColor()}; }
function inBounds(x,y){ return x>=0 && x<COLS && y>=0 && y<ROWS; }

/* ---------- init ---------- */
function init(){
  board = createBoard(ROWS, COLS);
  score = 0; chainDisplay = 0; totalCleared = 0;
  nextQueue = [];
  for(let i=0;i<6;i++) nextQueue.push(randPiece());
  resolving = false;
  popAnimations = [];
  chainPopEffects = [];
  gameOver = false;
  paused = false;
  hidePauseOverlay();
  spawnPiece();
  lastTime = performance.now();
  dropTimer = 0;
  updateHUD();
  requestAnimationFrame(loop);
}

/* ---------- spawn ---------- */
function spawnPiece(){
  const p = nextQueue.shift();
  nextQueue.push(randPiece());
  active = { x: Math.floor(COLS/2)-1, y: HIDDEN_ROWS, dir:0, a:p.a, b:p.b };
  const positions = getActiveCells(active);
  for(const pos of positions){
    if(!inBounds(pos.x,pos.y) || board[pos.y][pos.x] !== null){
      gameOver = true;
      setTimeout(()=>{ alert('ゲームオーバー 💀'); }, 60);
      return;
    }
  }
  renderNext();
  updateHUD();
}

/* ---------- active cells ---------- */
function getActiveCells(p){
  let cx = p.x, cy = p.y;
  if(p.dir === 0) cy = p.y - 1;
  if(p.dir === 1) cx = p.x + 1;
  if(p.dir === 2) cy = p.y + 1;
  if(p.dir === 3) cx = p.x - 1;
  return [{x:p.x,y:p.y,color:p.a,part:'A'},{x:cx,y:cy,color:p.b,part:'B'}];
}

/* ---------- movement checks ---------- */
function canMoveActive(dx,dy,dir=null){
  const test = {...active, x: active.x + dx, y: active.y + dy, dir: (dir===null?active.dir:dir)};
  const cells = getActiveCells(test);
  for(const c of cells){
    if(!inBounds(c.x,c.y)) return false;
    if(board[c.y][c.x] !== null) return false;
  }
  return true;
}

/* ---------- lock active ---------- */
function lockActive(){
  const cells = getActiveCells(active);
  for(const c of cells){
    if(inBounds(c.x,c.y)){
      board[c.y][c.x] = c.color;
    } else {
      gameOver = true;
    }
  }
  startResolveChains();
}

/* ---------- chain resolution ---------- */
function startResolveChains(){
  if(resolving) return;
  resolving = true;
  chainDisplay = 0;
  let totalTurnCleared = 0;
  let totalAddScore = 0;

  (function step(){
    const groups = findGroups();
    if(groups.length === 0){
      resolving = false;
      totalCleared += totalTurnCleared;
      score += totalAddScore;
      chainDisplay = 0;
      updateHUD();
      setTimeout(()=>{ if(!gameOver) spawnPiece(); }, 120);
      return;
    }

    chainDisplay++;
    const removedCount = groups.reduce((s,g)=>s+g.length,0);
    totalTurnCleared += removedCount;

    const chainMultiplier = Math.pow(1.5, chainDisplay-1);
    const groupBonus = 1 + 0.3*(groups.length - 1);
    const add = Math.floor(removedCount * 10 * chainMultiplier * groupBonus);
    totalAddScore += add;

    const popCells = [];
    for(const g of groups){
      for(const cell of g){
        const col = board[cell.y][cell.x];
        popCells.push({x:cell.x, y:cell.y, color: col});
        board[cell.y][cell.x] = null;
      }
    }

    const now = performance.now();
    const popDuration = 450;
    for(const pc of popCells){
      popAnimations.push({
        x: pc.x, y: pc.y, color: pc.color,
        start: now, dur: popDuration
      });
    }

    chainPopEffects.push({
      text: `${chainDisplay} CHAIN +${add}`,
      life: 1500,
      t: performance.now(),
      x: canvas.width/2,
      y: 60
    });

    updateHUD();
    
    setTimeout(()=>{
      applyGravityFull();
      setTimeout(step, 300);
    }, 420);
  })();
}

/* ---------- groups detection ---------- */
function findGroups(){
  const visited = Array.from({length:ROWS},()=>Array(COLS).fill(false));
  const groups = [];
  for(let y=0;y<ROWS;y++){
    for(let x=0;x<COLS;x++){
      const col = board[y][x];
      if(!col || visited[y][x]) continue;
      const q = [{x,y}];
      const grp = [];
      visited[y][x] = true;
      while(q.length){
        const cur = q.shift();
        grp.push(cur);
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(d=>{
          const nx = cur.x + d[0], ny = cur.y + d[1];
          if(nx<0||nx>=COLS||ny<0||ny>=ROWS) return;
          if(visited[ny][nx]) return;
          if(board[ny][nx] === col){
            visited[ny][nx] = true;
            q.push({x:nx,y:ny});
          }
        });
      }
      if(grp.length >= 4) groups.push(grp);
    }
  }
  return groups;
}

/* ---------- gravity ---------- */
function applyGravityFull(){
  for(let x=0;x<COLS;x++){
    for(let y=ROWS-1;y>=0;y--){
      if(board[y][x] === null){
        for(let yy=y-1;yy>=0;yy--){
          if(board[yy][x] !== null){
            board[y][x] = board[yy][x];
            board[yy][x] = null;
            break;
          }
        }
      }
    }
  }
  updateHUD();
}

/* ---------- input (Pでpause) ---------- */
const keys = {};
document.addEventListener('keydown',(e)=>{
  if(e.code === 'KeyP'){ togglePause(); return; } // P は常に受け付ける
  if(gameOver || resolving || paused) return;
  if(keys[e.code]) return;
  keys[e.code] = true;

  if(e.code === 'ArrowLeft') moveActive(-1,0);
  if(e.code === 'ArrowRight') moveActive(1,0);
  if(e.code === 'ArrowDown') softDrop();
  if(e.code === 'Space') hardDrop();
  if(e.code === 'KeyZ' || e.code === 'ArrowUp') rotateActive(-1);
  if(e.code === 'KeyX' || e.code === 'ShiftRight' || e.code === 'ShiftLeft') rotateActive(1);
  if(e.code === 'KeyC') instantDrop();
});
document.addEventListener('keyup',(e)=>{ keys[e.code] = false; });

function moveActive(dx,dy){
  if(canMoveActive(dx,dy)){
    active.x += dx; active.y += dy;
  } else if(dy === 1){
    lockActive();
  }
}
function softDrop(){ if(canMoveActive(0,1)){ active.y += 1; } else { lockActive(); } }
function hardDrop(){ while(canMoveActive(0,1)) active.y += 1; lockActive(); }
function instantDrop(){ hardDrop(); }
function rotateActive(dir){
  const newDir = (active.dir + dir + 4) % 4;
  const kicks = [[0,0],[-1,0],[1,0],[0,-1],[-2,0],[2,0]];
  for(const k of kicks){
    if(canMoveActive(k[0],k[1],newDir)){
      active.x += k[0]; active.y += k[1]; active.dir = newDir; return;
    }
  }
}

/* ---------- draw ---------- */
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#071726';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // board (skip hidden rows)
  for(let y=HIDDEN_ROWS;y<ROWS;y++){
    for(let x=0;x<COLS;x++){
      const val = board[y][x];
      drawCell(x, y - HIDDEN_ROWS, val);
    }
  }

  const now = performance.now();

  // pop animations
  for(let i=popAnimations.length-1;i>=0;i--){
    const a = popAnimations[i];
    const t = (now - a.start) / a.dur;
    if(t >= 1){
      popAnimations.splice(i,1);
      continue;
    }
    const scale = 1 + 0.6 * t;
    const alpha = 1 - t;
    drawPuyoAt(a.x, a.y - HIDDEN_ROWS, a.color, scale, alpha, true);
  }

  if(ghostOn && active){
    const ghost = cloneActive(active);
    while(canMoveActiveFor(ghost,0,1)){ ghost.y += 1; }
    const gcells = getActiveCells(ghost);
    ctx.globalAlpha = 0.8;
    for(const c of gcells){
      if(c.y >= HIDDEN_ROWS) drawCell(c.x, c.y - HIDDEN_ROWS, c.color, true);
    }
    ctx.globalAlpha = 1.0;
  }

  // active
  if(active){
    const cells = getActiveCells(active);
    for(const c of cells){
      if(c.y >= HIDDEN_ROWS) drawCell(c.x, c.y - HIDDEN_ROWS, c.color, false, true);
    }
  }

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for(let x=0;x<=COLS;x++){ ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL, VISIBLE_ROWS*CELL); ctx.stroke(); }
  for(let y=0;y<=VISIBLE_ROWS;y++){ ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(COLS*CELL, y*CELL); ctx.stroke(); }

  renderChainPopEffects();

}

function drawCell(gridX, gridY, colorKey, ghost=false, active=false){
  drawPuyoAt(gridX, gridY, colorKey, 1, 1, false, ghost);
}

function drawPuyoAt(gridX, gridY, colorKey, scale=1, alpha=1, isPop=false, ghost=false){
  const x = gridX * CELL, y = gridY * CELL;
  const size = CELL;
  const cx = x + size/2, cy = y + size/2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  const pad = 12;
  if(colorKey){
    const col = COLORS[colorKey] || '#999';
    roundRect(ctx, x+pad, y+pad, size - pad*2, size - pad*2, 10);
    ctx.fillStyle = col;
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.ellipse(x + size*0.32, y + size*0.28, size*0.13, size*0.09, 0,0,Math.PI*2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    roundRect(ctx, x+pad, y+pad, size - pad*2, size - pad*2, 10);
    ctx.fillStyle = '#071726';
    ctx.fill();
  }

  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

/* ---------- ghost helper ---------- */
function cloneActive(a){ return {x:a.x,y:a.y,dir:a.dir,a:a.a,b:a.b}; }
function canMoveActiveFor(obj,dx,dy){
  const test = {...obj, x: obj.x + dx, y: obj.y + dy};
  const cells = getActiveCells(test);
  for(const c of cells){
    if(!inBounds(c.x,c.y)) return false;
    if(board[c.y][c.x] !== null) return false;
  }
  return true;
}

/* ---------- next render ---------- */
function renderNext(){ drawNextCanvas(nextCtx, nextQueue[0]); drawNextCanvas(next2Ctx, nextQueue[1]); }
function drawNextCanvas(ctx2,piece){
  ctx2.clearRect(0,0,ctx2.canvas.width, ctx2.canvas.height);
  ctx2.fillStyle = '#071722'; ctx2.fillRect(0,0,ctx2.canvas.width, ctx2.canvas.height);
  if(!piece) return;
  const s = 40; const cx = ctx2.canvas.width/2, cy = 50;
  ctx2.fillStyle = COLORS[piece.a]; ctx2.beginPath(); ctx2.ellipse(cx-20, cy, s*0.9, s*0.9, 0,0,Math.PI*2); ctx2.fill();
  ctx2.fillStyle = COLORS[piece.b]; ctx2.beginPath(); ctx2.ellipse(cx+20, cy, s*0.9, s*0.9, 0,0,Math.PI*2); ctx2.fill();
}

/* ---------- main loop (paused を扱う) ---------- */
function loop(ts){
  if(gameOver) return;
  const dt = ts - lastTime;

  if(paused){
    lastTime = ts;
    draw();
    requestAnimationFrame(loop);
    return;
  }

  lastTime = ts;
  dropTimer += dt;
  if(dropTimer > dropInterval && !resolving){
    if(canMoveActive(0,1)) active.y += 1;
    else lockActive();
    dropTimer = 0;
  }
  draw();
  requestAnimationFrame(loop);
}

/* ---------- HUD ---------- */
function updateHUD(){
  document.getElementById('score').innerText = score;
  document.getElementById('chain').innerText = chainDisplay;
  document.getElementById('cleared').innerText = totalCleared;
}

/* ---------- chain popup DOM effects ---------- */
function renderChainPopEffects(){
  const now = performance.now();
  popupRoot.innerHTML = '';
  for(let i=chainPopEffects.length-1;i>=0;i--){
    const e = chainPopEffects[i];
    const t = now - e.t;
    if(t > e.life){ chainPopEffects.splice(i,1); continue; }
    const alpha = 1 - (t / e.life);
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.fontWeight = '800';
    el.style.color = '#ffd86b';
    el.style.fontSize = '20px';
    el.style.textShadow = '0 6px 18px rgba(0,0,0,0.6)';
    el.style.opacity = alpha;
    el.style.transform = `translateY(${- (t/12)}px) scale(${1 + (t/1500)})`;
    el.innerText = e.text;
    popupRoot.appendChild(el);
  }
}

/* ---------- Pause 操作関連 ---------- */
function showPauseOverlay(){
  pauseOverlay.classList.add('show');
  pauseOverlay.setAttribute('aria-hidden','false');
  pauseBtn.innerText = 'Resume';
}
function hidePauseOverlay(){
  pauseOverlay.classList.remove('show');
  pauseOverlay.setAttribute('aria-hidden','true');
  pauseBtn.innerText = 'Pause';
}
function togglePause(){
  if(gameOver) return;
  paused = !paused;
  if(paused){
    showPauseOverlay();
  } else {
    // resume 時に time jump を防ぐ
    lastTime = performance.now();
    hidePauseOverlay();
  }
}

/* Overlay の Resume ボタンと HUD Pause ボタンに紐付け */
pauseBtn.addEventListener('click', ()=>{ togglePause(); });
resumeBtn.addEventListener('click', ()=>{ if(paused) togglePause(); });

/* ---------- UI buttons ---------- */
document.getElementById('restart').addEventListener('click', ()=>{ init(); });
document.getElementById('toggleGhost').addEventListener('click', (e)=>{
  ghostOn = !ghostOn;
  e.target.innerText = `ゴースト: ${ghostOn ? 'ON':'OFF'}`;
});

/* ---------- ensure spawn ---------- */
if(!active) spawnPiece();
