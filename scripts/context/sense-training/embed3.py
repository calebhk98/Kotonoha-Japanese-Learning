"""Features for v3 (Japanese sentence + token + English sentence -> sense).
Usage: embed3.py items.jsonl out.pt [en_override.json]  (override maps ja -> machine translation)"""
import json, re, sys, torch
from transformers import AutoTokenizer, AutoModel
src, out = sys.argv[1], sys.argv[2]
override = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
torch.set_num_threads(4)
MISC = ['uk', 'arch', 'obs', 'rare', 'sl', 'col', 'hon', 'hum', 'pol', 'abbr', 'id', 'on-mim', 'fam', 'vulg', 'dated', 'joc']
STOP = set('to the a an of be in on at for with by one someone something oneself thing as up out off into from it is or e g etc esp'.split())
stem = lambda w: re.sub(r'(ing|ed|es|s)$', '', w)
def stems(t): return {stem(w) for w in re.findall(r'[a-z]+', t.lower()) if w not in STOP and len(w) > 2}
MAXC = 40
items = [json.loads(l) for l in open(src)]
for d in items:
    d['cands'] = d['cands'][:MAXC]
    if override is not None: d['en'] = override.get(d['ja'], '')
tok = AutoTokenizer.from_pretrained('intfloat/multilingual-e5-small')
model = AutoModel.from_pretrained('intfloat/multilingual-e5-small').eval()
def run(texts, maxlen=128, offsets=False):
    e = tok(texts, padding=True, truncation=True, max_length=maxlen, return_tensors='pt', return_offsets_mapping=offsets)
    off = e.pop('offset_mapping') if offsets else None
    with torch.no_grad(): h = model(**e).last_hidden_state
    return h, e['attention_mask'], off
# glosses
glosses = sorted({c['gloss'] for d in items for c in d['cands']})
gidx = {g: i for i, g in enumerate(glosses)}
gvec = torch.zeros(len(glosses), 384)
for b in range(0, len(glosses), 256):
    h, m, _ = run(['passage: ' + g for g in glosses[b:b + 256]], 64)
    m = m.unsqueeze(-1).float()
    gvec[b:b + 256] = torch.nn.functional.normalize((h * m).sum(1) / m.sum(1), dim=-1)
    if b % 25600 == 0: print('gloss', b, len(glosses), flush=True)
gstems = [stems(g) for g in glosses]
# sentences
by_sent = {}
for k, d in enumerate(items): by_sent.setdefault(d['ja'], []).append(k)
sents = list(by_sent)
N = len(items)
ctx = torch.zeros(N, 384, dtype=torch.float16); jvec = torch.zeros(N, 384, dtype=torch.float16); evec = torch.zeros(N, 384, dtype=torch.float16)
cand_g, cand_f = [None] * N, [None] * N
P = len('query: ')
for b in range(0, len(sents), 64):
    chunk = sents[b:b + 64]
    hj, mj, offs = run(['query: ' + s for s in chunk], 128, True)
    ens = [items[by_sent[s][0]]['en'] or '' for s in chunk]
    he, me, _ = run(['query: ' + e for e in ens], 96)
    hen = torch.nn.functional.normalize(he, dim=-1)
    for j, s in enumerate(chunk):
        m = mj[j].unsqueeze(-1).float(); sv = (hj[j] * m).sum(0) / m.sum()
        me_j = me[j].bool().clone(); me_j[:3] = False  # skip <s> and "query:" pieces
        ev = he[j][me[j].bool()].mean(0)
        en_st = stems(ens[j])
        for k in by_sent[s]:
            d = items[k]
            a, e2 = d['start'] + P, d['end'] + P
            sel = [t for t in range(offs.shape[1]) if mj[j, t] and offs[j, t, 1] > a and offs[j, t, 0] < e2]
            ctx[k] = (hj[j, sel].mean(0) if sel else sv).half(); jvec[k] = sv.half(); evec[k] = ev.half()
            gi = [gidx[c['gloss']] for c in d['cands']]
            sims = (gvec[gi] @ hen[j][me_j].T) if me_j.any() else torch.zeros(len(gi), 1)
            mx = sims.max(1).values if sims.numel() else torch.zeros(len(gi))
            feats = []
            for ci, c in enumerate(d['cands']):
                ov = gstems[gi[ci]] & en_st
                feats.append([c['sense'] / 10, float(c['sense'] == 0), float(c['common']), float(c['primary']),
                              float(mx[ci]), float(bool(ov)), len(ov) / max(len(gstems[gi[ci]]), 1), float(bool(ens[j]))]
                             + [float(x in c['misc']) for x in MISC])
            cand_g[k], cand_f[k] = gi, feats
    if b % 6400 == 0: print('sent', b, len(sents), flush=True)
torch.save({'ctx': ctx, 'jvec': jvec, 'evec': evec, 'gvec': gvec.half(), 'cand_g': cand_g, 'cand_f': cand_f,
            'gold': [d['gold'] for d in items], 'weight': [d['weight'] for d in items], 'tagged': [d['tagged'] for d in items],
            'meta': [{'ja': d['ja'], 'en': d['en'], 'surface': d['surface'], 'cands': [c['gloss'] for c in d['cands']]} for d in items]}, out)
print('saved', N, 'items', len(glosses), 'glosses')
