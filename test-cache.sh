#!/bin/bash

# Test script to verify cache behavior across multiple scenarios
# Tests: multiple words in story, same words across stories, persistence

set -e

BASE_URL="http://localhost:3000"
RESULTS_FILE="/tmp/cache-test-results.txt"

echo "=== Cache Persistence Test Suite ===" | tee "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test 1: Multiple words in the same story
echo "Test 1: Multiple words in same story (should cache reuse within story)" | tee -a "$RESULTS_FILE"
STORY1='{"id":"story-1","text":"これは日本語です。これは簡単です。これが好きです。"}'
echo "Request 1 (story with repeated words):" | tee -a "$RESULTS_FILE"

START=$(date +%s%N)
RESPONSE=$(curl -s -X POST "$BASE_URL/api/batch-extract" \
  -H "Content-Type: application/json" \
  -d "{\"texts\":[$STORY1]}")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

WORD_COUNT=$(echo "$RESPONSE" | jq '.[0].words | length' 2>/dev/null || echo "0")
echo "Words extracted: $WORD_COUNT, Duration: ${DURATION_MS}ms" | tee -a "$RESULTS_FILE"
echo "$RESPONSE" | jq '.[0].words[] | "\(.word) (\(.frequencyInContent)x)"' 2>/dev/null | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test 2: Same words across different stories (cache reuse across requests)
echo "Test 2: Same words across different stories (should reuse cache)" | tee -a "$RESULTS_FILE"
STORY2='{"id":"story-2","text":"これは重要です。これを覚えてください。"}'
echo "Request 2 (different story, overlapping words):" | tee -a "$RESULTS_FILE"

START=$(date +%s%N)
RESPONSE=$(curl -s -X POST "$BASE_URL/api/batch-extract" \
  -H "Content-Type: application/json" \
  -d "{\"texts\":[$STORY2]}")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

WORD_COUNT=$(echo "$RESPONSE" | jq '.[0].words | length' 2>/dev/null || echo "0")
echo "Words extracted: $WORD_COUNT, Duration: ${DURATION_MS}ms (should be faster)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test 3: Multiple stories in single batch (mixed cache hits/misses)
echo "Test 3: Multiple stories in single batch (mixed cache behavior)" | tee -a "$RESULTS_FILE"
STORY3='{"id":"story-3","text":"日本の文化は素晴らしい。"}'
STORY4='{"id":"story-4","text":"これが最後のテストです。"}'
echo "Request 3 (batch with 2 stories):" | tee -a "$RESULTS_FILE"

START=$(date +%s%N)
RESPONSE=$(curl -s -X POST "$BASE_URL/api/batch-extract" \
  -H "Content-Type: application/json" \
  -d "{\"texts\":[$STORY3,$STORY4]}")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

TOTAL_WORDS=$(echo "$RESPONSE" | jq '[.[].words | length] | add' 2>/dev/null || echo "0")
echo "Total words extracted: $TOTAL_WORDS, Duration: ${DURATION_MS}ms" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test 4: Repeat same story (should be much faster - all from cache)
echo "Test 4: Repeat same story (should use all cached words - very fast)" | tee -a "$RESULTS_FILE"
echo "Request 4 (story-1 again):" | tee -a "$RESULTS_FILE"

START=$(date +%s%N)
RESPONSE=$(curl -s -X POST "$BASE_URL/api/batch-extract" \
  -H "Content-Type: application/json" \
  -d "{\"texts\":[$STORY1]}")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

WORD_COUNT=$(echo "$RESPONSE" | jq '.[0].words | length' 2>/dev/null || echo "0")
echo "Words extracted: $WORD_COUNT, Duration: ${DURATION_MS}ms (should be <100ms)" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test 5: Very large batch with many repeated words
echo "Test 5: Large batch to stress test caching" | tee -a "$RESULTS_FILE"
STORIES=$(for i in {1..5}; do
  echo "{\"id\":\"batch-story-$i\",\"text\":\"これは$iです。日本語で$iを言います。\"}"
done | paste -sd ',' -)
echo "Request 5 (5 stories with overlapping words):" | tee -a "$RESULTS_FILE"

START=$(date +%s%N)
RESPONSE=$(curl -s -X POST "$BASE_URL/api/batch-extract" \
  -H "Content-Type: application/json" \
  -d "{\"texts\":[$STORIES]}")
END=$(date +%s%N)
DURATION_MS=$(( (END - START) / 1000000 ))

TOTAL_STORIES=$(echo "$RESPONSE" | jq 'length' 2>/dev/null || echo "0")
TOTAL_WORDS=$(echo "$RESPONSE" | jq '[.[].words | length] | add' 2>/dev/null || echo "0")
echo "Stories: $TOTAL_STORIES, Total words: $TOTAL_WORDS, Duration: ${DURATION_MS}ms" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

echo "=== Summary ===" | tee -a "$RESULTS_FILE"
echo "Cache test complete! Check results above." | tee -a "$RESULTS_FILE"
echo "Expected pattern: Request 4 should be MUCH faster than Requests 1-3" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"
echo "Test results saved to: $RESULTS_FILE" | tee -a "$RESULTS_FILE"
