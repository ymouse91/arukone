const fs = require('fs');
const {performance} = require('perf_hooks');

const file = process.argv[2] || 'puzzles.json';
const puzzles = JSON.parse(fs.readFileSync(file, 'utf8'));

function key(p) { return p.r + ',' + p.c; }
function same(a, b) { return a && b && a.r === b.r && a.c === b.c; }
function man(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c); }

function difficultyLevel(score) {
  if (score >= 125) return 'erittain vaikea';
  if (score >= 90) return 'vaikea';
  if (score >= 60) return 'keskitaso';
  return 'helppo';
}

function pathBounds(path) {
  return path.reduce((box, p) => ({
    minR:Math.min(box.minR, p.r),
    maxR:Math.max(box.maxR, p.r),
    minC:Math.min(box.minC, p.c),
    maxC:Math.max(box.maxC, p.c)
  }), {minR:Infinity, maxR:-Infinity, minC:Infinity, maxC:-Infinity});
}

function endpointInteractionCount(candidate, answerPaths) {
  if (!Array.isArray(answerPaths)) return 0;
  const endpoints = candidate.endpoints.flatMap((pair, id) => pair.map(p => ({...p, id})));
  let total = 0;
  answerPaths.forEach((path, id) => {
    const pathKeys = new Set(path.map(key));
    const box = pathBounds(path);
    for (const endpoint of endpoints) {
      if (endpoint.id === id || pathKeys.has(key(endpoint))) continue;
      const nearPath = path.some(p => man(p, endpoint) === 1);
      const insideBox = endpoint.r > box.minR && endpoint.r < box.maxR && endpoint.c > box.minC && endpoint.c < box.maxC;
      if (nearPath || insideBox) total++;
    }
  });
  return total;
}

function calculateDifficulty(candidate, result={}) {
  const answerPaths = candidate.answerPaths || result.answerPaths || [];
  const lengths = Array.isArray(answerPaths) ? answerPaths.map(path => path.length) : [];
  const longestPath = lengths.length ? Math.max(...lengths) : 0;
  const averagePath = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const endpointInteractions = endpointInteractionCount(candidate, answerPaths);
  const nodes = Math.max(1, Number(result.nodes || candidate.solutionCheck?.nodes || 1));
  const timeoutPenalty = result.timeout ? 25 : 0;
  const multiPenalty = result.solutions && result.solutions > 1 ? 10 : 0;
  const score = Math.round(
    Math.log10(nodes + 1) * 12
    + longestPath * 0.8
    + averagePath * 0.2
    + endpointInteractions * 0.8
    + candidate.count
    + timeoutPenalty
    + multiPenalty
  );
  return {
    score,
    level:difficultyLevel(score),
    nodes,
    timeout:!!result.timeout,
    solutions:Number.isInteger(result.solutions) ? result.solutions : null,
    longestPath,
    averagePath:Math.round(averagePath * 10) / 10,
    endpointInteractions
  };
}

function countSolutions(candidate, maxSolutions, nodeLimit, deadlineMs) {
  const n = candidate.size;
  const work = Array.from({length:n}, () => Array(n).fill(-1));
  const heads = [];
  const targets = [];
  const done = [];
  const routes = [];
  const memo = new Map();
  const answerNext = new Map();
  const started = performance.now();
  let nodes = 0;
  let timeout = false;
  let firstSolution = null;

  function pointKey(p) { return p.r + ',' + p.c; }
  function localInside(p) { return p.r >= 0 && p.r < n && p.c >= 0 && p.c < n; }
  function localNeighbors(p) {
    return [{r:p.r-1,c:p.c},{r:p.r+1,c:p.c},{r:p.r,c:p.c-1},{r:p.r,c:p.c+1}].filter(localInside);
  }
  function isTarget(p, id) { return same(p, targets[id]); }
  function isOpenTerminal(p) {
    for (let id=0; id<candidate.count; id++) {
      if (!done[id] && (same(p, heads[id]) || same(p, targets[id]))) return true;
    }
    return false;
  }
  function isOpenForEmpty(p) {
    return work[p.r][p.c] === -1 || isOpenTerminal(p);
  }

  for (let id=0; id<candidate.count; id++) {
    const pair = candidate.endpoints[id];
    heads[id] = {r:pair[0].r, c:pair[0].c};
    targets[id] = {r:pair[1].r, c:pair[1].c};
    done[id] = false;
    routes[id] = [{r:heads[id].r, c:heads[id].c}];
    work[heads[id].r][heads[id].c] = id;
    work[targets[id].r][targets[id].c] = id;
  }

  if (Array.isArray(candidate.answerPaths)) {
    candidate.answerPaths.forEach((path, id) => {
      for (let i=0; i<path.length - 1; i++) {
        answerNext.set(id + ':' + pointKey(path[i]), pointKey(path[i + 1]));
      }
    });
  }

  function openCount() {
    let count = 0;
    for (let r=0; r<n; r++) for (let c=0; c<n; c++) if (work[r][c] === -1) count++;
    return count;
  }

  function moveAllowed(id, p) {
    if (!(work[p.r][p.c] === -1 || isTarget(p, id))) return false;
    if (isTarget(p, id)) return true;
    for (const q of localNeighbors(p)) {
      if (same(q, heads[id]) || isTarget(q, id)) continue;
      if (work[q.r][q.c] === id) return false;
    }
    return true;
  }

  function legalMoves(id) {
    if (done[id]) return [];
    return localNeighbors(heads[id]).filter(p => moveAllowed(id, p));
  }

  function canReachTarget(id) {
    if (done[id]) return true;
    const seen = new Set();
    const stack = [heads[id]];
    while (stack.length) {
      const p = stack.pop();
      const pKey = pointKey(p);
      if (seen.has(pKey)) continue;
      seen.add(pKey);
      if (isTarget(p, id)) return true;
      for (const q of localNeighbors(p)) {
        if (!seen.has(pointKey(q)) && (work[q.r][q.c] === -1 || isTarget(q, id))) stack.push(q);
      }
    }
    return false;
  }

  function hasDeadEndCell() {
    for (let r=0; r<n; r++) for (let c=0; c<n; c++) {
      if (work[r][c] !== -1) continue;
      const exits = localNeighbors({r,c}).filter(isOpenForEmpty).length;
      if (exits < 2) return true;
    }
    return false;
  }

  function hasImpossibleEmptyComponent() {
    const seen = new Set();
    for (let r=0; r<n; r++) for (let c=0; c<n; c++) {
      const start = {r,c};
      const startKey = pointKey(start);
      if (work[r][c] !== -1 || seen.has(startKey)) continue;
      const touchesHead = Array(candidate.count).fill(false);
      const touchesTarget = Array(candidate.count).fill(false);
      const stack = [start];
      seen.add(startKey);
      while (stack.length) {
        const p = stack.pop();
        for (const q of localNeighbors(p)) {
          const qKey = pointKey(q);
          if (work[q.r][q.c] === -1 && !seen.has(qKey)) {
            seen.add(qKey);
            stack.push(q);
          } else {
            for (let id=0; id<candidate.count; id++) {
              if (done[id]) continue;
              if (same(q, heads[id])) touchesHead[id] = true;
              if (same(q, targets[id])) touchesTarget[id] = true;
            }
          }
        }
      }
      let canBeUsed = false;
      for (let id=0; id<candidate.count; id++) {
        if (touchesHead[id] && touchesTarget[id]) {
          canBeUsed = true;
          break;
        }
      }
      if (!canBeUsed) return true;
    }
    return false;
  }

  function prune() {
    if (hasDeadEndCell()) return true;
    const open = openCount();
    for (let id=0; id<candidate.count; id++) {
      if (!done[id] && legalMoves(id).length === 0) return true;
      if (!canReachTarget(id)) return true;
      if (!done[id] && man(heads[id], targets[id]) > open + 1) return true;
    }
    return hasImpossibleEmptyComponent();
  }

  function stateKey() {
    let out = '';
    for (let r=0; r<n; r++) for (let c=0; c<n; c++) out += work[r][c] < 0 ? '.' : String.fromCharCode(65 + work[r][c]);
    out += '|';
    for (let id=0; id<candidate.count; id++) out += (done[id] ? 'x' : pointKey(heads[id])) + ';';
    return out;
  }

  function wallDistance(p) {
    return Math.min(p.r, p.c, n - 1 - p.r, n - 1 - p.c);
  }

  function chooseColor() {
    let bestId = null;
    let bestMoves = null;
    let bestScore = Infinity;
    for (let id=0; id<candidate.count; id++) {
      if (done[id]) continue;
      const moves = legalMoves(id);
      const score = moves.length * 100 + man(heads[id], targets[id]) * 2 + wallDistance(heads[id]) + routes[id].length * 0.01;
      if (bestMoves === null || score < bestScore) {
        bestId = id;
        bestMoves = moves;
        bestScore = score;
      }
    }
    return {id:bestId, moves:bestMoves || []};
  }

  function moveScore(id, p) {
    const preferred = answerNext.get(id + ':' + pointKey(heads[id]));
    if (preferred && preferred === pointKey(p)) return -20;
    if (isTarget(p, id)) return openCount() === 0 ? -10 : 8;
    const onward = localNeighbors(p).filter(q => moveAllowed(id, q)).length;
    return onward * 12 + man(p, targets[id]) * 3 + wallDistance(p);
  }

  function applyStep(id, p, trail) {
    const enteringTarget = isTarget(p, id);
    trail.push({id, p, oldHead:heads[id], oldDone:done[id], filled:!enteringTarget, routeLength:routes[id].length});
    heads[id] = {r:p.r, c:p.c};
    routes[id].push({r:p.r, c:p.c});
    if (enteringTarget) done[id] = true;
    else work[p.r][p.c] = id;
  }

  function undoTrail(trail) {
    for (let i=trail.length - 1; i>=0; i--) {
      const item = trail[i];
      if (item.filled) work[item.p.r][item.p.c] = -1;
      done[item.id] = item.oldDone;
      heads[item.id] = item.oldHead;
      routes[item.id].length = item.routeLength;
    }
  }

  function applyForcedMoves(trail) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let id=0; id<candidate.count; id++) {
        if (done[id]) continue;
        const moves = legalMoves(id);
        if (moves.length === 0) return false;
        if (moves.length === 1) {
          applyStep(id, moves[0], trail);
          changed = true;
          break;
        }
      }
    }
    return true;
  }

  function dfs() {
    if (timeout) return 0;
    nodes++;
    if (nodes > nodeLimit || performance.now() - started > deadlineMs) {
      timeout = true;
      return 0;
    }

    const forcedTrail = [];
    if (!applyForcedMoves(forcedTrail)) {
      undoTrail(forcedTrail);
      return 0;
    }
    if (prune()) {
      undoTrail(forcedTrail);
      return 0;
    }
    if (done.every(Boolean)) {
      const solved = openCount() === 0 ? 1 : 0;
      if (solved && !firstSolution) {
        firstSolution = routes.map(path => path.map(p => ({r:p.r, c:p.c})));
      }
      undoTrail(forcedTrail);
      return solved;
    }

    const skey = stateKey();
    if (memo.has(skey)) {
      const cached = memo.get(skey);
      undoTrail(forcedTrail);
      return cached;
    }

    const choice = chooseColor();
    let total = 0;
    const moves = choice.moves.map(p => ({p, score:moveScore(choice.id, p)})).sort((a,b) => a.score - b.score);
    for (const move of moves) {
      const trail = [];
      applyStep(choice.id, move.p, trail);
      total += dfs();
      undoTrail(trail);
      if (total >= maxSolutions || timeout) {
        total = Math.min(total, maxSolutions);
        break;
      }
    }
    if (!timeout) memo.set(skey, total);
    undoTrail(forcedTrail);
    return total;
  }

  const solutions = dfs();
  return {solutions, timeout, nodes, memo:memo.size, answerPaths:firstSolution};
}

const limit = {nodes:650000, ms:10000};
const ranked = puzzles.map((puzzle, index) => {
  process.stdout.write(`ranking ${index + 1}/${puzzles.length}\r`);
  const result = countSolutions(puzzle, 2, limit.nodes, limit.ms);
  const solution = puzzle.answerPaths || result.answerPaths;
  const rankedPuzzle = {
    ...puzzle,
    answerPaths:solution || puzzle.answerPaths,
    solutionCheck:{
      mode:'ranking',
      solutions:result.solutions,
      timeout:result.timeout,
      nodes:result.nodes,
      memo:result.memo
    }
  };
  rankedPuzzle.unique = !result.timeout && result.solutions === 1;
  rankedPuzzle.difficulty = calculateDifficulty(rankedPuzzle, result);
  return rankedPuzzle;
});

ranked.sort((a, b) =>
  a.difficulty.score - b.difficulty.score
  || Number(a.size) - Number(b.size)
  || Number(a.count) - Number(b.count)
);
ranked.forEach((puzzle, index) => {
  puzzle.difficulty.rank = index + 1;
});

fs.writeFileSync(file, JSON.stringify(ranked, null, 2) + '\n', 'utf8');

const levels = ranked.reduce((acc, puzzle) => {
  acc[puzzle.difficulty.level] = (acc[puzzle.difficulty.level] || 0) + 1;
  return acc;
}, {});
const sizes = ranked.reduce((acc, puzzle) => {
  acc[puzzle.size] = (acc[puzzle.size] || 0) + 1;
  return acc;
}, {});
console.log('\n' + JSON.stringify({
  file,
  total:ranked.length,
  easiest:ranked[0].difficulty,
  hardest:ranked[ranked.length - 1].difficulty,
  levels,
  sizes
}, null, 2));
