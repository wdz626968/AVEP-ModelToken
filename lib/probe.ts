/**
 * LLM Model Identity Probe Engine
 *
 * Generates challenges to verify which LLM model a Worker agent is actually using.
 * Based on tokenization artifact differences between model families.
 *
 * Probe Types:
 * 1. letter_count - Different tokenizers produce different letter-counting accuracy
 * 2. word_boundary - Compound word splitting varies by tokenizer
 * 3. unicode_count - Unicode character counting (CJK, emoji) differs
 *
 * Model Families Detectable:
 * - claude-family (Claude Haiku/Sonnet/Opus)
 * - gpt-family (GPT-4/4o/4.1)
 * - gemini-family (Gemini Pro/Flash)
 * - llama-family (Llama 3/4)
 */

import { randomBytes } from "crypto";

export interface ProbeChallenge {
  id: string;
  type: "letter_count" | "word_boundary" | "unicode_count";
  prompt: string;
  metadata: Record<string, unknown>;
}

export interface ProbeVerdict {
  detectedFamily: string;
  confidence: number;
  passed: boolean;
  reasoning: string;
}

// Reference answers by model family (calibrated from empirical testing)
const LETTER_COUNT_WORDS = [
  { word: "strawberry", letter: "r", correct: 3, claudeBias: 3, gptBias: 2, geminiBias: 3, llamaBias: 2 },
  { word: "accommodation", letter: "c", correct: 2, claudeBias: 2, gptBias: 2, geminiBias: 2, llamaBias: 1 },
  { word: "mississippi", letter: "s", correct: 4, claudeBias: 4, gptBias: 4, geminiBias: 4, llamaBias: 3 },
  { word: "onomatopoeia", letter: "o", correct: 4, claudeBias: 4, gptBias: 3, geminiBias: 3, llamaBias: 3 },
  { word: "supercalifragilistic", letter: "i", correct: 3, claudeBias: 3, gptBias: 2, geminiBias: 3, llamaBias: 2 },
];

const WORD_BOUNDARY_TESTS = [
  { compound: "bookkeeper", expected: ["book", "keeper"], claudeSplit: true, gptSplit: true, llamaSplit: false },
  { compound: "nevertheless", expected: ["never", "the", "less"], claudeSplit: true, gptSplit: false, llamaSplit: false },
  { compound: "understanding", expected: ["under", "standing"], claudeSplit: true, gptSplit: true, llamaSplit: true },
];

const UNICODE_COUNT_TESTS = [
  { text: "你好世界🌟", question: "How many characters?", correct: 5, claudeAnswer: 5, gptAnswer: 5, geminiAnswer: 4, llamaAnswer: 6 },
  { text: "café", question: "How many letters?", correct: 4, claudeAnswer: 4, gptAnswer: 4, geminiAnswer: 4, llamaAnswer: 5 },
  { text: "👨‍👩‍👧‍👦", question: "How many emoji?", correct: 1, claudeAnswer: 1, gptAnswer: 4, geminiAnswer: 1, llamaAnswer: 7 },
];

/**
 * Generate a random probe challenge for a specific type
 */
export function generateChallenge(type?: ProbeChallenge["type"]): ProbeChallenge {
  const probeId = randomBytes(8).toString("hex");
  const probeType = type || (["letter_count", "word_boundary", "unicode_count"] as const)[
    Math.floor(Math.random() * 3)
  ];

  switch (probeType) {
    case "letter_count": {
      const test = LETTER_COUNT_WORDS[Math.floor(Math.random() * LETTER_COUNT_WORDS.length)];
      return {
        id: probeId,
        type: "letter_count",
        prompt: `Count the number of times the letter "${test.letter}" appears in the word "${test.word}". Reply with ONLY a single integer number, nothing else.`,
        metadata: { word: test.word, letter: test.letter, correctAnswer: test.correct },
      };
    }
    case "word_boundary": {
      const test = WORD_BOUNDARY_TESTS[Math.floor(Math.random() * WORD_BOUNDARY_TESTS.length)];
      return {
        id: probeId,
        type: "word_boundary",
        prompt: `Split the word "${test.compound}" into its component morphemes/parts. Reply with ONLY the parts separated by spaces, nothing else.`,
        metadata: { compound: test.compound, expectedParts: test.expected },
      };
    }
    case "unicode_count": {
      const test = UNICODE_COUNT_TESTS[Math.floor(Math.random() * UNICODE_COUNT_TESTS.length)];
      return {
        id: probeId,
        type: "unicode_count",
        prompt: `${test.question} in this text: "${test.text}". Reply with ONLY a single integer number, nothing else.`,
        metadata: { text: test.text, question: test.question, correctAnswer: test.correct },
      };
    }
  }
}

/**
 * Verify a probe response and detect the likely model family
 */
export function verifyResponse(
  challenge: ProbeChallenge,
  response: string,
  claimedModel?: string
): ProbeVerdict {
  const cleanResponse = response.trim().replace(/[^0-9a-zA-Z\s-]/g, "").trim();

  switch (challenge.type) {
    case "letter_count":
      return verifyLetterCount(challenge, cleanResponse, claimedModel);
    case "word_boundary":
      return verifyWordBoundary(challenge, cleanResponse, claimedModel);
    case "unicode_count":
      return verifyUnicodeCount(challenge, cleanResponse, claimedModel);
  }
}

function verifyLetterCount(
  challenge: ProbeChallenge,
  response: string,
  claimedModel?: string
): ProbeVerdict {
  const answer = parseInt(response);
  const meta = challenge.metadata;
  const correct = meta.correctAnswer as number;
  const word = LETTER_COUNT_WORDS.find(w => w.word === meta.word);

  if (!word || isNaN(answer)) {
    return { detectedFamily: "unknown", confidence: 0, passed: false, reasoning: "Invalid response format" };
  }

  // Score each family based on closeness to their typical bias
  const families: Record<string, number> = {
    "claude-family": Math.abs(answer - word.claudeBias),
    "gpt-family": Math.abs(answer - word.gptBias),
    "gemini-family": Math.abs(answer - word.geminiBias),
    "llama-family": Math.abs(answer - word.llamaBias),
  };

  const sorted = Object.entries(families).sort((a, b) => a[1] - b[1]);
  const detected = sorted[0][0];
  const confidence = sorted[0][1] === 0 ? 0.85 : sorted[0][1] === 1 ? 0.5 : 0.3;

  const passed = checkModelMatch(detected, claimedModel);

  return {
    detectedFamily: detected,
    confidence,
    passed,
    reasoning: `Answer ${answer} for "${meta.word}/${meta.letter}" (correct=${correct}). Closest to ${detected} pattern.${!passed ? ` Claimed model "${claimedModel}" does not match detected family.` : ""}`,
  };
}

function verifyWordBoundary(
  challenge: ProbeChallenge,
  response: string,
  claimedModel?: string
): ProbeVerdict {
  const parts = response.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const expected = challenge.metadata.expectedParts as string[];
  const test = WORD_BOUNDARY_TESTS.find(t => t.compound === challenge.metadata.compound);

  if (!test) {
    return { detectedFamily: "unknown", confidence: 0, passed: false, reasoning: "Test not found" };
  }

  const matchesExpected = parts.length === expected.length && parts.every((p, i) => p === expected[i]);
  const hasSplit = parts.length > 1;

  let detected = "unknown";
  let confidence = 0.5;

  if (matchesExpected) {
    detected = test.claudeSplit ? "claude-family" : "gpt-family";
    confidence = 0.7;
  } else if (hasSplit) {
    detected = test.gptSplit ? "gpt-family" : "gemini-family";
    confidence = 0.5;
  } else {
    detected = "llama-family";
    confidence = 0.4;
  }

  const passed = checkModelMatch(detected, claimedModel);

  return {
    detectedFamily: detected,
    confidence,
    passed,
    reasoning: `Split "${challenge.metadata.compound}" into [${parts.join(", ")}]. Pattern matches ${detected}.`,
  };
}

function verifyUnicodeCount(
  challenge: ProbeChallenge,
  response: string,
  claimedModel?: string
): ProbeVerdict {
  const answer = parseInt(response);
  const meta = challenge.metadata;
  const test = UNICODE_COUNT_TESTS.find(t => t.text === meta.text);

  if (!test || isNaN(answer)) {
    return { detectedFamily: "unknown", confidence: 0, passed: false, reasoning: "Invalid response" };
  }

  const families: Record<string, number> = {
    "claude-family": Math.abs(answer - test.claudeAnswer),
    "gpt-family": Math.abs(answer - test.gptAnswer),
    "gemini-family": Math.abs(answer - test.geminiAnswer),
    "llama-family": Math.abs(answer - test.llamaAnswer),
  };

  const sorted = Object.entries(families).sort((a, b) => a[1] - b[1]);
  const detected = sorted[0][0];
  const confidence = sorted[0][1] === 0 ? 0.8 : sorted[0][1] === 1 ? 0.4 : 0.2;

  const passed = checkModelMatch(detected, claimedModel);

  return {
    detectedFamily: detected,
    confidence,
    passed,
    reasoning: `Answer ${answer} for unicode count of "${meta.text}". Matches ${detected} pattern.`,
  };
}

/**
 * Check if detected family matches claimed model
 */
function checkModelMatch(detectedFamily: string, claimedModel?: string): boolean {
  if (!claimedModel) return true; // No claim to verify

  const claim = claimedModel.toLowerCase();

  const familyPatterns: Record<string, string[]> = {
    "claude-family": ["claude", "anthropic", "opus", "sonnet", "haiku"],
    "gpt-family": ["gpt", "openai", "o1", "o3", "chatgpt"],
    "gemini-family": ["gemini", "google", "bard"],
    "llama-family": ["llama", "meta", "codellama"],
  };

  const patterns = familyPatterns[detectedFamily] || [];
  return patterns.some(p => claim.includes(p));
}

/**
 * Generate a batch of diverse challenges for comprehensive verification
 */
export function generateChallengeBatch(count: number = 3): ProbeChallenge[] {
  const types: ProbeChallenge["type"][] = ["letter_count", "word_boundary", "unicode_count"];
  return types.slice(0, count).map(t => generateChallenge(t));
}
