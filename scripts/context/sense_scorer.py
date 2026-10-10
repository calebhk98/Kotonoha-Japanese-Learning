"""Trained sense scorer: Japanese sentence + token + English translation ->
probability of each sense of the token's chosen JMDict entry.

Frozen multilingual-e5-small features (the token's contextual embedding,
the Japanese and English sentence embeddings, each gloss's embedding, the
gloss's best match among the English tokens, gloss-word overlap with the
English, and the sense's JMDict facts) scored by a small network trained on
half the Tanaka corpus (scripts/context/sense-training/). The features
here must match sense-training/embed3.py exactly.
"""
import os
import re

import torch
import torch.nn as nn
from transformers import AutoModel, AutoTokenizer

E5 = "intfloat/multilingual-e5-small"
WEIGHTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sense_scorer.pt")
MISC = ['uk', 'arch', 'obs', 'rare', 'sl', 'col', 'hon', 'hum', 'pol', 'abbr', 'id', 'on-mim', 'fam', 'vulg', 'dated', 'joc']
STOP = set('to the a an of be in on at for with by one someone something oneself thing as up out off into from it is or e g etc esp'.split())


def stems(t):
    return {re.sub(r'(ing|ed|es|s)$', '', w) for w in re.findall(r'[a-z]+', t.lower()) if w not in STOP and len(w) > 2}


class Scorer(nn.Module):
    def __init__(self, nf):
        super().__init__()
        self.pc, self.pj, self.pe = nn.Linear(384, 384), nn.Linear(384, 384), nn.Linear(384, 384)
        self.mlp = nn.Sequential(nn.Linear(384 * 4 + nf, 256), nn.GELU(), nn.Dropout(0.1), nn.Linear(256, 1))

    def forward(self, c, j, e, g, f):
        P = lambda lin, v: nn.functional.normalize(lin(v), dim=-1).unsqueeze(0).expand_as(g)
        return self.mlp(torch.cat([P(self.pc, c) * g, P(self.pj, j) * g, P(self.pe, e) * g, g, f], -1)).squeeze(-1)


class SenseScorer:
    def __init__(self):
        ck = torch.load(WEIGHTS)
        self.model = Scorer(ck['nf'])
        self.model.load_state_dict({k: v.float() for k, v in ck['state'].items()})
        self.model.eval()
        self.tok = AutoTokenizer.from_pretrained(E5)
        self.enc = AutoModel.from_pretrained(E5).eval()
        self.gcache = {}

    def _run(self, text, maxlen, offsets=False):
        e = self.tok([text], truncation=True, max_length=maxlen, return_tensors='pt', return_offsets_mapping=offsets)
        off = e.pop('offset_mapping')[0] if offsets else None
        with torch.no_grad():
            h = self.enc(**e).last_hidden_state[0]
        return h, off

    def _gloss(self, glosses):
        need = [g for g in glosses if g not in self.gcache]
        if need:
            e = self.tok(['passage: ' + g for g in need], padding=True, truncation=True, max_length=64, return_tensors='pt')
            with torch.no_grad():
                h = self.enc(**e).last_hidden_state
            m = e['attention_mask'].unsqueeze(-1).float()
            for g, v in zip(need, nn.functional.normalize((h * m).sum(1) / m.sum(1), dim=-1)):
                self.gcache[g] = v
            if len(self.gcache) > 50000:
                self.gcache.clear()
        return torch.stack([self.gcache[g] for g in glosses])

    def sentence(self, ja, en):
        """Per-sentence features, reused for every token in it."""
        hj, offs = self._run('query: ' + ja, 128, True)
        he, _ = self._run('query: ' + (en or ''), 96)
        return {'hj': hj, 'offs': offs, 'jvec': hj.mean(0), 'evec': he.mean(0),
                'hen': nn.functional.normalize(he[3:], dim=-1), 'en_stems': stems(en or ''), 'has_en': float(bool(en))}

    def probs(self, S, start, end, senses, info):
        P = len('query: ')
        a, b = start + P, end + P
        sel = [t for t in range(S['offs'].shape[0]) if S['offs'][t, 1] > a and S['offs'][t, 0] < b]
        c = S['hj'][sel].mean(0) if sel else S['jvec']
        glosses = ['; '.join(g[:4]) for g in senses]
        gv = self._gloss(glosses)
        mx = (gv @ S['hen'].T).max(1).values if S['hen'].shape[0] else torch.zeros(len(glosses))
        feats = []
        for k, g in enumerate(glosses):
            gs = stems(g)
            ov = gs & S['en_stems']
            i = info[k]
            feats.append([i['index'] / 10, float(i['index'] == 0), float(i['common']), float(i['primary']),
                          float(mx[k]), float(bool(ov)), len(ov) / max(len(gs), 1), S['has_en']]
                         + [float(x in i['misc']) for x in MISC])
        with torch.no_grad():
            p = torch.softmax(self.model(c, S['jvec'], S['evec'], gv, torch.tensor(feats)), -1)
        return [round(float(x), 4) for x in p]
