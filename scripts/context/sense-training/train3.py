"""Train v3: score each candidate (entry+sense) from the Japanese token,
Japanese sentence, English sentence and the candidate's gloss.
Usage: train3.py train.pt out.pt eval1.pt [eval2.pt ...]"""
import sys, torch, random
import torch.nn as nn
torch.manual_seed(0); random.seed(0)
T = torch.load(sys.argv[1]); outp = sys.argv[2]; EV = [(p, torch.load(p)) for p in sys.argv[3:]]
NF = len(T['cand_f'][0][0])
def batch(D, idx):
    n = max(len(D['cand_g'][i]) for i in idx)
    g = torch.zeros(len(idx), n, 384); f = torch.zeros(len(idx), n, NF); m = torch.zeros(len(idx), n, dtype=torch.bool)
    for r, i in enumerate(idx):
        k = len(D['cand_g'][i]); g[r, :k] = D['gvec'][D['cand_g'][i]].float(); f[r, :k] = torch.tensor(D['cand_f'][i]); m[r, :k] = True
    return (D['ctx'][idx].float(), D['jvec'][idx].float(), D['evec'][idx].float(), g, f, m,
            torch.tensor([D['gold'][i] for i in idx]), torch.tensor([D['weight'][i] for i in idx]))
class Scorer(nn.Module):
    def __init__(s):
        super().__init__()
        s.pc, s.pj, s.pe = nn.Linear(384, 384), nn.Linear(384, 384), nn.Linear(384, 384)
        s.mlp = nn.Sequential(nn.Linear(384 * 4 + NF, 256), nn.GELU(), nn.Dropout(0.1), nn.Linear(256, 1))
    def forward(s, c, j, e, g, f, m):
        P = lambda lin, v: nn.functional.normalize(lin(v), dim=-1).unsqueeze(1).expand_as(g)
        x = torch.cat([P(s.pc, c) * g, P(s.pj, j) * g, P(s.pe, e) * g, g, f], -1)
        return s.mlp(x).squeeze(-1).masked_fill(~m, -1e9)
def evaluate(model, D, idx=None):
    idx = idx or list(range(len(D['gold']))); model.eval(); r = {'all': [0, 0], 'tagged': [0, 0], 'base': [0, 0]}
    with torch.no_grad():
        for b in range(0, len(idx), 512):
            ii = idx[b:b + 512]; c, j, e, g, f, m, y, _ = batch(D, ii)
            p = model(c, j, e, g, f, m).argmax(-1)
            # simple baseline: common + primary entry, lowest sense index
            base = (f[..., 2] * 2 + f[..., 3] * 2 - f[..., 0] * 3).masked_fill(~m, -1e9).argmax(-1)
            for k, i in enumerate(ii):
                ok = int(p[k] == y[k]); r['all'][0] += ok; r['all'][1] += 1; r['base'][0] += int(base[k] == y[k]); r['base'][1] += 1
                if D['tagged'][i]: r['tagged'][0] += ok; r['tagged'][1] += 1
    model.train(); return {k: round(a / max(n, 1), 3) for k, (a, n) in r.items()}
n = len(T['gold']); perm = list(range(n)); random.shuffle(perm); val, trn = perm[:5000], perm[5000:]
print('train', len(trn), 'val', len(val))
model = Scorer(); opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
best = (0, None)
for epoch in range(3):
    random.shuffle(trn)
    for b in range(0, len(trn), 256):
        c, j, e, g, f, m, y, w = batch(T, trn[b:b + 256])
        loss = (nn.functional.cross_entropy(model(c, j, e, g, f, m), y, reduction='none') * w).mean()
        opt.zero_grad(); loss.backward(); opt.step()
    va = evaluate(model, T, val)
    print('epoch', epoch, 'val', va, *[(p.rsplit('/', 1)[1], evaluate(model, D)) for p, D in EV], flush=True)
    if va['all'] > best[0]: best = (va['all'], {k: v.clone() for k, v in model.state_dict().items()})
model.load_state_dict(best[1])
for p, D in EV: print('FINAL', p.rsplit('/', 1)[1], evaluate(model, D))
torch.save({'state': best[1], 'nf': NF}, outp)
