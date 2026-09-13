import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])]),
    )
  }
  return value
}

export const policyVectorPayload = vectors => {
  if (
    vectors?.format !== 1 ||
    !/^[0-9a-f]{40}$/.test(vectors.budabitCommit || "") ||
    !Number.isFinite(Date.parse(vectors.generatedAt)) ||
    !Array.isArray(vectors.scenarios) ||
    !vectors.scenarios.length ||
    !Array.isArray(vectors.definitions) ||
    !vectors.definitions.length
  ) {
    throw new Error("Invalid policy-vector format or missing source provenance")
  }
  const {budabitCommit: _commit, generatedAt: _time, ...payload} = vectors
  return JSON.stringify(canonical(payload))
}

export const checkPolicyVectors = (fresh, committed, expectedBudabitCommit) => {
  const actual = policyVectorPayload(fresh)
  const expected = policyVectorPayload(committed)
  if (fresh.budabitCommit !== expectedBudabitCommit) {
    throw new Error(`Fresh vectors were not exported from Budabit ${expectedBudabitCommit}`)
  }
  const digest = value => createHash("sha256").update(value).digest("hex")
  if (actual !== expected) {
    throw new Error(
      `strfry policy vectors are stale (fresh ${digest(actual)}, pinned ${digest(expected)}). Update the reviewed strfry fixture/plugin first, then community-policy-conformance.json. Do not update only a hash to bypass conformance.`,
    )
  }
  return digest(actual)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [freshPath, committedPath, commit] = process.argv.slice(2)
  if (!freshPath || !committedPath || !commit) {
    console.error(
      "Usage: node scripts/check-community-policy-vectors.mjs FRESH_JSON PINNED_JSON BUDABIT_COMMIT",
    )
    process.exitCode = 2
  } else {
    try {
      const digest = checkPolicyVectors(
        JSON.parse(readFileSync(freshPath, "utf8")),
        JSON.parse(readFileSync(committedPath, "utf8")),
        commit,
      )
      console.log(`Community policy vectors match the pinned relay: sha256:${digest}`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
