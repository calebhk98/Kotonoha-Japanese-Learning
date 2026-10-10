"""Sentence translation + per-token sense evidence for the resolution pipeline.

Long-running helper spoken to over stdin/stdout, one JSON object per line
(see src/lib/contextModel.ts for the TypeScript side). No LLM: a small
Japanese->English translation model (FuguMT, Marian, 61M params, greedy
decoding: its beam search degenerates) and a small English sentence
embedder (bge-small-en-v1.5).

Request:  {"sentences": [{"text": "...", "candidates": [{"start": 0, "end": 2,
           "senses": [["gloss", ...], ...]}]}]}
Response: {"sentences": [{"translation": "...", "candidates": [{"aligned":
           ["sign", "contract"], "sims": [0.61, 0.74, ...]}]}]}

For each candidate (a token's character span within its sentence) the
English words the model attended to most while translating that span are
"aligned"; "sims" is the cosine similarity of those words to each sense's
glosses. Choosing a sense from the sims is left to the caller.
On startup it prints {"ready": true} once the models are loaded.
"""
import json
import os
import re
import sys

MODELS = os.environ.get("KOTONOHA_MODELS") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".models")
os.environ.setdefault("HF_HOME", MODELS)
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch  # noqa: E402
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # noqa: E402
from sentence_transformers import SentenceTransformer  # noqa: E402

MT_MODEL = "staka/fugumt-ja-en"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
# Cross-attention layers averaged for alignment (measured on graded cases:
# the middle layers align best; the last layer mostly attends to </s>).
ATTN_LAYERS = slice(3, 6)
TOP_ALIGNED = 3

STOP = set("""a an the of to be is are was were been being am it its in on at by for with from as and or but not no
that this these those he she they we you i his her their our your my me him them us who whom which what there here do
does did have has had will would can could may might shall should must one some any etc e.g. i.e. someone something
somebody oneself usu often esp sth sb s about up out into over more most very so than then too also just if when while
thing things way such own other another""".split())


def content_word(w):
    w = re.sub(r"[^a-z]", "", w.lower())
    return len(w) > 1 and w not in STOP


def src_spans(pieces, sent):
    """Character span of each source sentencepiece within the sentence."""
    spans, p = [], 0
    for t in pieces:
        t = t.replace("▁", "")
        if t in ("</s>", "<pad>", "<unk>") or not t:
            spans.append((p, p))
            continue
        i = sent.find(t, p)
        if i < 0 or i - p > 3:
            spans.append((p, p))
            continue
        spans.append((i, i + len(t)))
        p = i + len(t)
    return spans


class Enricher:
    def __init__(self):
        torch.set_num_threads(int(os.environ.get("KOTONOHA_THREADS", "4")))
        self.tok = AutoTokenizer.from_pretrained(MT_MODEL)
        self.mt = AutoModelForSeq2SeqLM.from_pretrained(MT_MODEL, attn_implementation="eager").eval()
        self.embed = SentenceTransformer(EMBED_MODEL)
        self.cache = {}

    def translate(self, text):
        # Cached: a text is translated once even when asked twice (the
        # pipeline asks for translations first, then for sense evidence).
        if text in self.cache:
            return self.cache[text]
        if len(self.cache) > 20000:
            self.cache.clear()
        self.cache[text] = self._translate(text)
        return self.cache[text]

    def _translate(self, text):
        enc = self.tok(text, return_tensors="pt", truncation=True, max_length=256)
        with torch.no_grad():
            out = self.mt.generate(**enc, num_beams=1, do_sample=False, max_new_tokens=200)
            forced = self.mt(**enc, decoder_input_ids=out[:1], output_attentions=True)
        attn = torch.stack([a[0].mean(0) for a in forced.cross_attentions[ATTN_LAYERS]]).mean(0).tolist()
        return {
            "text": self.tok.decode(out[0], skip_special_tokens=True),
            "src": self.tok.convert_ids_to_tokens(enc.input_ids[0]),
            "tgt": self.tok.convert_ids_to_tokens(out[0]),
            "attn": attn,
        }

    @staticmethod
    def aligned(tr, sent, start, end):
        """English words most attended to while translating sent[start:end]."""
        spans = src_spans(tr["src"], sent)
        idx = [i for i, (a, b) in enumerate(spans) if b > a and a < end and b > start]
        words, cur = [], None
        for j in range(1, len(tr["tgt"])):
            t = tr["tgt"][j]
            if t in ("</s>", "<pad>"):
                continue
            mass = sum(tr["attn"][j - 1][i] for i in idx) if idx else 0.0
            if t.startswith("▁") or cur is None:
                cur = [t.replace("▁", ""), mass]
                words.append(cur)
            else:
                cur[0] += t
                cur[1] = max(cur[1], mass)
        ranked = sorted(((m, k) for k, (w, m) in enumerate(words) if content_word(w)), reverse=True)[:TOP_ALIGNED]
        return [re.sub(r"[^\w'-]", "", words[k][0]) for _, k in ranked]

    def run(self, request):
        out = []
        for s in request.get("sentences", []):
            cands = s.get("candidates", [])
            tr = self.translate(s["text"])
            if not cands:
                out.append({"translation": tr["text"], "candidates": []})
                continue
            aligned = [self.aligned(tr, s["text"], c["start"], c["end"]) for c in cands]
            queries = self.embed.encode([" ".join(a) or tr["text"] for a in aligned], normalize_embeddings=True)
            glosses = [", ".join(g[:4]) for c in cands for g in c["senses"]]
            gemb = self.embed.encode(glosses, normalize_embeddings=True, batch_size=64) if glosses else []
            res, o = [], 0
            for c, a, q in zip(cands, aligned, queries):
                n = len(c["senses"])
                sims = [round(float(x), 4) for x in (gemb[o:o + n] @ q)] if n else []
                o += n
                res.append({"aligned": a, "sims": sims})
            out.append({"translation": tr["text"], "candidates": res})
        return {"sentences": out}


def main():
    enricher = Enricher()
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            resp = enricher.run(json.loads(line))
        except Exception as e:  # report, keep serving
            resp = {"error": str(e)}
        print(json.dumps(resp, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
