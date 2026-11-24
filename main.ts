// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  const clean=lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  let a=0,b=clean.length-1;while(a<=b&&blank(clean[a]!))a++;while(b>=a&&blank(clean[b]!))b--;
  if(clean[a]?.startsWith('```'))clean.splice(a,1);
  b=clean.length-1;while(b>=0&&blank(clean[b]!))b--;if(clean[b]?.trim()==='```')clean.splice(b,1);
  return clean;
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly renames: [string, string][] = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function fileParts(s: string): { lines: string[]; br: string; final: boolean } {
  const n = s.indexOf('\n'), br = n > 0 && s[n - 1] === '\r' ? '\r\n' : '\n';
  if (!s) return { lines: [], br, final: false };
  const lines = s.split(br), final = s.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}
function tierMatches(hay: string[], needle: string[], strict: boolean): { tier: number; at: number[] } | null {
  for (let tier = 0; tier <= (strict ? 0 : 2); tier++) {
    const norm = (s: string) => tier === 1 ? s.replace(/[ \t]+$/, '') : tier === 2 ? s.replace(/^[ \t]+|[ \t]+$/g, '') : s;
    const at: number[] = [];
    for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((x,j) => norm(hay[i+j]!) === norm(x))) at.push(i);
    if (at.length) return { tier, at };
  }
  return null;
}
function indent(s: string): string { return (s.match(/^[ \t]*/) ?? [''])[0]; }
function applyLines(lines: string[], old: string[], neu: string[], strict: boolean, occurrence: (a: number[]) => number, contexts = true, contextPairs?: [number, number][]): string[] {
  const m = tierMatches(lines, old, strict);
  if (!m) throw new Fail('no-match', '');
  const at = occurrence(m.at), out = neu.slice();
  if (m.tier === 2 && old.length) {
    const f = indent(lines[at]!), p = indent(old[0]!);
    const contextsAt = new Set((contextPairs ?? old.map((x,i) => x === neu[i] ? [i,i] as [number,number] : null).filter((x): x is [number,number] => x !== null)).map(x=>x[1]));
    for (let i=0;i<out.length;i++) if (!contextsAt.has(i) && out[i] !== '' && out[i]!.trim() && out[i]!.startsWith(p)) out[i] = f + out[i]!.slice(p.length);
  }
  if (contexts) for (const [o,n] of contextPairs ?? old.map((x,i) => x === neu[i] ? [i,i] as [number,number] : null).filter((x): x is [number,number] => x !== null)) out[n] = lines[at+o]!;
  return [...lines.slice(0,at), ...out, ...lines.slice(at+old.length)];
}
function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  type H={a:number; old:string[]; neu:string[]; noNl:boolean; ctx:[number,number][]}; type S={old:string|null; neu:string|null; create:boolean; del:boolean; hunks:H[]};
  const ss:S[]=[]; let s:S|null=null, i=0;
  const strip=(p:string, pre:string)=>p.split('\t')[0]!.trim().replace(new RegExp('^'+pre+'/'), '');
  while(i<lines.length){ const l=lines[i]!;
    if(l.startsWith('diff --git ')){ const m=/^diff --git a\/(.+) b\/(.+)$/.exec(l); if(!m) throw new Exit2(`error: parse ${i+1}`); s={old:m[1]!,neu:m[2]!,create:false,del:false,hunks:[]};ss.push(s);i++;continue; }
    if(l.startsWith('--- ') && (lines[i+1]??'').startsWith('+++ ')){
      if(s && !s.hunks.length && s.old!==null && s.neu!==null && ss[ss.length-1]===s){s.old=strip(l.slice(4),'a');s.neu=strip(lines[i+1]!.slice(4),'b');}
      else {s={old:strip(l.slice(4),'a'),neu:strip(lines[i+1]!.slice(4),'b'),create:false,del:false,hunks:[]};ss.push(s);}
      if(s.old==='/dev/null')s.create=true;if(s.neu==='/dev/null')s.del=true;i+=2;continue;
    }
    if(l.startsWith('--- ') && s && !s.hunks.length && !(lines[i+1]??'').startsWith('+++ '))throw new Exit2(`error: parse ${i+2}`);
    if(l.startsWith('@@')){ if(!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?:.*)$/.test(l))throw new Exit2(`error: parse ${i+1}`); if(!s)throw new Exit2(`error: parse ${i+1}`); const a=Number(/^@@ -(\d+)/.exec(l)![1]); const h:H={a,old:[],neu:[],noNl:false,ctx:[]};i++;
      while(i<lines.length && !(lines[i]!.startsWith('diff --git ') || (lines[i]!.startsWith('--- ')&&(lines[i+1]??'').startsWith('+++ ')))){
        const x=lines[i]!; if(x.startsWith('\\')){h.noNl=true;i++;continue;} if(x===''||x[0]===' '){h.ctx.push([h.old.length,h.neu.length]);h.old.push(x===''?'':x.slice(1));h.neu.push(x===''?'':x.slice(1));}else if(x[0]==='-')h.old.push(x.slice(1));else if(x[0]==='+')h.neu.push(x.slice(1));else break;i++;
      } s.hunks.push(h);continue;
    }
    if(s && l==='new file mode')s.create=true; if(s&&l==='deleted file mode')s.del=true;
    if(s&&l.startsWith('rename from '))s.old=l.slice(12).trim();if(s&&l.startsWith('rename to '))s.neu=l.slice(10).trim(); i++;
  }
  return ss.map(sec=>tree=>{ const op=sec.old!, np=sec.neu!; for(const p of [op,np])if(p!=='/dev/null'&&!safe(p))throw new Fail('unsafe',p); if(sec.del||np==='/dev/null'){if(tree.get(op)===null)throw new Fail('missing',op);tree.now.set(op,null);return;} if(sec.create||op==='/dev/null'){if(tree.get(np)!==null)throw new Fail('exists',np);const add=sec.hunks.flatMap(h=>h.neu);tree.now.set(np,add.join('\n')+(sec.hunks.at(-1)?.noNl?'':'\n'));return;} const src=tree.get(op);if(src===null)throw new Fail('missing',op);if(np!==op&&tree.get(np)!==null)throw new Fail('exists',np);const fp=fileParts(src);let ls=fp.lines,d=0, final=fp.final;for(const h of sec.hunks){let at:number,touchesEnd=false;if(h.old.length){const m=tierMatches(ls,h.old,strict);if(!m)throw new Fail('no-match',op);at=m.at.sort((a,b)=>Math.abs(a-(h.a-1+d))-Math.abs(b-(h.a-1+d))||a-b)[0]!;touchesEnd=at+h.old.length===ls.length;const before=ls.length;ls=applyLines(ls,h.old,h.neu,strict,()=>at,true,h.ctx);d+=ls.length-before;}else{at=Math.min(ls.length,h.a+d);touchesEnd=at===ls.length;ls=[...ls.slice(0,at),...h.neu,...ls.slice(at)];d+=h.neu.length;} if(touchesEnd) final=!h.noNl; } const out=ls.length?ls.join(fp.br)+(final?fp.br:''):'';tree.now.set(op,null);tree.now.set(np,out);if(np!==op)tree.renames.push([op,np]);});
}
function searchEdits(lines:string[],strict:boolean):Edit[]{const out:Edit[]=[];let prev=-1,lastPath:string|null=null;for(let i=0;i<lines.length;i++)if(lines[i]!.trimEnd()==='<<<<<<< SEARCH'){let eq=i+1;while(eq<lines.length&&lines[eq]!.trimEnd()!=='=======')eq++;let end=eq+1;while(end<lines.length&&lines[end]!.trimEnd()!=='>>>>>>> REPLACE')end++;if(eq===lines.length||end===lines.length)throw new Exit2(`error: parse ${i+1}`);let p:string|null=null;for(let j=i-1;j>prev;j--)if(!blank(lines[j]!)&&!lines[j]!.trim().startsWith('```')){p=lines[j]!.trim();break;}if(p===null)p=lastPath;if(p===null)throw new Exit2(`error: parse ${i+1}`);lastPath=p;prev=end;const old=lines.slice(i+1,eq),neu=lines.slice(eq+1,end);out.push(tree=>{if(!safe(p!))throw new Fail('unsafe',p!);if(!old.length){if(tree.get(p!)!==null)throw new Fail('exists',p!);tree.now.set(p!,neu.join('\n')+'\n');return;}const src=tree.get(p!);if(src===null)throw new Fail('missing',p!);const fp=fileParts(src),m=tierMatches(fp.lines,old,strict);if(!m)throw new Fail('no-match',p!);if(m.at.length!==1)throw new Fail('ambiguous',p!);tree.now.set(p!,applyLines(fp.lines,old,neu,strict,()=>m.at[0]!).join(fp.br)+(fp.final?fp.br:''));});i=end;}if(!out.length)throw new Exit2('error: parse 1');return out;}
function v4aEdits(lines:string[],strict:boolean):Edit[]{const first=lines.findIndex(x=>!blank(x)),last=(()=>{for(let j=lines.length-1;j>=0;j--)if(!blank(lines[j]!))return j;return -1;})();if(first<0||lines[first]!.trim()!=='*** Begin Patch')throw new Exit2(`error: parse ${first<0?1:first+1}`);if(last<0||lines[last]!.trim()!=='*** End Patch')throw new Exit2(`error: parse ${lines.length+1}`);const out:Edit[]=[];let i=first+1;while(i<last){if(blank(lines[i]!)){i++;continue;}const head=lines[i]!,m=/^\*\*\* (Add File|Delete File|Update File): (.*)$/.exec(head);if(!m)throw new Exit2(`error: parse ${i+1}`);const typ=m[1]!,p=m[2]!.trim(),hline=i+1;i++;const body:string[]=[];while(i<last&&!/^\*\*\* (?:Add File|Delete File|Update File): /.test(lines[i]!)){body.push(lines[i++]!);}while(body.length&&blank(body[body.length-1]!))body.pop();if(typ==='Add File'){const add=body.map(x=>{if(x==='' )return '';if(!x.startsWith('+'))throw new Exit2(`error: parse ${i-body.length+body.indexOf(x)+1}`);return x.slice(1);});out.push(t=>{if(!safe(p))throw new Fail('unsafe',p);if(t.get(p)!==null)throw new Fail('exists',p);t.now.set(p,add.join('\n')+'\n');});}else if(typ==='Delete File'){if(body.length)throw new Exit2(`error: parse ${hline+1}`);out.push(t=>{if(!safe(p))throw new Fail('unsafe',p);if(t.get(p)===null)throw new Fail('missing',p);t.now.set(p,null);});}else{if(!body.length)throw new Exit2(`error: parse ${hline}`);out.push(t=>{if(!safe(p))throw new Fail('unsafe',p);const src=t.get(p);if(src===null)throw new Fail('missing',p);const fp=fileParts(src);let ls=fp.lines,cursor=0,k=0,move:string|null=null, final=fp.final;while(k<body.length){let anchor:string|null=null;if(body[k]!.startsWith('*** Move to: ')){move=body[k++]!.slice(13).trim();}let eof=false;if(body[k]?.startsWith('@@')){anchor=body[k]!.slice(2).trim()||null;k++;}if(body[k]==='*** End of File'){eof=true;k++;}const items:{t:' '|'-'|'+';s:string}[]=[];while(k<body.length&&!body[k]!.startsWith('@@')&&body[k]!=='*** End of File'){const x=body[k++]!;if(x===''||x[0]===' ')items.push({t:' ',s:x===''?'':x.slice(1)});else if(x[0]==='-')items.push({t:'-',s:x.slice(1)});else if(x[0]==='+')items.push({t:'+',s:x.slice(1)});else throw new Fail('no-match',p);}const old=items.filter(x=>x.t!=='+' ).map(x=>x.s);if(anchor){const am=tierMatches(ls.slice(cursor),[anchor],strict);if(!am)throw new Fail('no-match',p);cursor+=am.at[0]!+1;}let at=cursor, matchTier=0;if(eof){if(old.length===0){cursor=ls.length;at=cursor;}else{const mm=tierMatches(ls.slice(cursor),old,strict);if(!mm||!mm.at.includes(ls.length-cursor-old.length))throw new Fail('no-match',p);at=ls.length-old.length;matchTier=mm.tier;cursor=at;}}else if(old.length){const mm=tierMatches(ls.slice(cursor),old,strict);if(!mm)throw new Fail('no-match',p);matchTier=mm.tier;at=cursor+mm.at[0]!;}const repl:string[]=[];let oi=0;const f=old.length?indent(ls[at]!):'',q=old.length?indent(old[0]!):'';for(const item of items){if(item.t===' '){repl.push(ls[at+oi++]!);}else if(item.t==='-')oi++;else{let value=item.s;if(matchTier===2&&value!==''&&value.trim()&&value.startsWith(q))value=f+value.slice(q.length);repl.push(value);}}if(old.length)ls=[...ls.slice(0,at),...repl,...ls.slice(at+old.length)];else ls=[...ls.slice(0,at),...repl,...ls.slice(at)];cursor=at+repl.length;}const dest=move??p;if(move){if(!safe(move))throw new Fail('unsafe',move);if(t.get(move)!==null)throw new Fail('exists',move);t.now.set(p,null);t.renames.push([p,move]);}t.now.set(dest,ls.join(fp.br)+(final?fp.br:''));});}}
if(!out.length)throw new Exit2('error: parse 1');return out;}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? searchEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: string[] = [];
  const moved = new Set<string>();
  for(const [from,to] of tree.renames){rows.push(`R ${from} -> ${to}`);moved.add(from);moved.add(to);}
  for (const [from, value] of tree.now) if (value === null && tree.original(from) !== null && !moved.has(from)) {
    const to = [...tree.now].find(([p, v]) => p !== from && v !== null && tree.original(p) === null && v === tree.original(from) && !moved.has(p))?.[0];
    if (to) { rows.push(`R ${from} -> ${to}`); moved.add(from); moved.add(to); }
  }
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    if (moved.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push(`${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}`);
    if (check) continue;
    if (now === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
