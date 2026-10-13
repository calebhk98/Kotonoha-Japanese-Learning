"""Dataset v3: Japanese sentence + token + English sentence -> definition.
Candidates are every English sense of every JMDict entry written like the
headword (entry AND sense are chosen). Gold: the tagged entry; its tagged
sense, else sense 1 at half weight. Split: half the corpus (by sentence
hash) for training; the eval sample is always excluded from training.
Usage: build3.py jmdict.json examples.utf eval_sample.jsonl out_train.jsonl out_eval.jsonl"""
import json, re, sys, collections, hashlib
jm_path, ex_path, eval_path, out_tr, out_ev = sys.argv[1:6]
jm = json.load(open(jm_path))['words']
by_form = collections.defaultdict(list); by_id = {}
for w in jm:
    by_id[w['id']] = w
    for f in w['kanji'] + w['kana']: by_form[f['text']].append(w)
def eng(s): return [g['text'] for g in s['gloss'] if g['lang'] == 'eng']
def esenses(w): return [s for s in w['sense'] if eng(s)][:10]
GRAMMAR = {'prt', 'aux', 'aux-v', 'aux-adj', 'cop', 'conj'}
B_RE = re.compile(r'^(?P<head>[^(\[{~]+)(?:\((?P<par>[^)]+)\))?(?:\[(?P<sense>\d+)\])?(?:\{(?P<surf>[^}]+)\})?~?$')
eval_ja = {json.loads(l)['ja'] for l in open(eval_path)}
half = lambda s: int(hashlib.md5(s.encode()).hexdigest(), 16) % 2 == 0
stats = collections.Counter()
ftr, fev = open(out_tr, 'w'), open(out_ev, 'w')
ja = en = None
for line in open(ex_path, encoding='utf-8'):
    if line.startswith('A: '):
        ja, _, rest = line[3:].rstrip('\n').partition('\t'); en = rest.split('#ID=')[0]; continue
    if not line.startswith('B: ') or ja is None: continue
    is_eval = ja in eval_ja
    if not is_eval and not half(ja): ja = None; stats['other_half'] += 1; continue
    out = fev if is_eval else ftr
    cur = 0
    for item in line[3:].split():
        m = B_RE.match(item)
        if not m: continue
        head, par, sn = m['head'], m['par'], m['sense']
        surf = m['surf'] or head
        i = ja.find(surf, cur)
        if i < 0: continue
        cur = i + len(surf)
        ents = list(by_form.get(head, []))
        if not ents: continue
        if par and par.startswith('#'): gold = [w for w in ents if w['id'] == par[1:]]
        elif par: gold = [w for w in ents if any(k['text'] == par for k in w['kana'])]
        else: gold = ents if len(ents) == 1 else [w for w in ents if (w['kanji'] and w['kanji'][0]['text'] == head) or (not w['kanji'] and w['kana'][0]['text'] == head)]
        if len(gold) != 1: stats['gold_ambiguous'] += 1; continue
        g = gold[0]
        pos = {p for s in g['sense'] for p in s['partOfSpeech']}
        if pos and pos <= GRAMMAR | {'exp'} and len(head) <= 2: continue
        # Gold entry first, then the others (most senses kept for the gold).
        ents = [g] + [w for w in ents if w['id'] != g['id']][:7]
        cands = []
        for w in ents:
            common = any(x.get('common') for x in w['kanji'] + w['kana'])
            primary = (w['kanji'] or w['kana'])[0]['text'] == head
            for k, s in enumerate(esenses(w)):
                cands.append({'entry': w['id'], 'sense': k, 'misc': s['misc'], 'gloss': '; '.join(eng(s)[:4]),
                              'common': common, 'primary': primary})
        if len(cands) < 2: continue
        gs = int(sn) - 1 if sn else 0
        if gs >= len(esenses(g)): continue
        out.write(json.dumps({'ja': ja, 'en': en, 'start': i, 'end': i + len(surf), 'head': head, 'surface': surf,
                              'gold': gs, 'weight': 1.0 if sn else 0.5, 'tagged': bool(sn), 'cands': cands}, ensure_ascii=False) + '\n')
        stats['eval_items' if is_eval else 'train_items'] += 1
    ja = None
print(dict(stats))
