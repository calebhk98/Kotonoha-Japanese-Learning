"""Machine-translate the Japanese sentences of an items file with FuguMT
(greedy, like the app). Usage: mt.py items.jsonl out.json"""
import json, sys, torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
torch.set_num_threads(2)
src, out = sys.argv[1:3]
sents = sorted({json.loads(l)['ja'] for l in open(src)})
tok = AutoTokenizer.from_pretrained('staka/fugumt-ja-en')
mt = AutoModelForSeq2SeqLM.from_pretrained('staka/fugumt-ja-en').eval()
res = {}
for b in range(0, len(sents), 16):
    chunk = sents[b:b + 16]
    enc = tok(chunk, return_tensors='pt', padding=True, truncation=True, max_length=256)
    with torch.no_grad():
        o = mt.generate(**enc, num_beams=1, do_sample=False, max_new_tokens=200)
    for s, t in zip(chunk, tok.batch_decode(o, skip_special_tokens=True)): res[s] = t
    if b % 320 == 0: print(b, len(sents), flush=True)
json.dump(res, open(out, 'w'), ensure_ascii=False)
print('done', len(res))
