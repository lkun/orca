#!/usr/bin/env node
/**
 * Apply the OCC rebrand to a clean upstream checkout.
 *
 * Usage:
 *   node scripts/occ-rebrand/apply.mjs /path/to/upstream-worktree
 *
 * The target must be a Git worktree with no uncommitted changes. The script:
 *   1. renames every tracked path containing the legacy product token
 *   2. rewrites text files with the same case mapping
 *   3. restores the first-party relay wire constants that must keep their
 *      production values for the official mobile app
 *
 * Run this from the OCC working tree against a separate upstream worktree so
 * the script itself is never rewritten.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const target = path.resolve(process.argv[2] ?? '')
if (!target || !fs.existsSync(target)) {
  console.error('usage: node scripts/occ-rebrand/apply.mjs <upstream-worktree>')
  process.exit(2)
}

const git = (...args) =>
  execFileSync('git', ['-C', target, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  })

if (git('status', '--porcelain').trim()) {
  console.error('target worktree is not clean')
  process.exit(2)
}

const map = (value) =>
  value.replace(/orca/gi, (match) => (match === 'Orca' || match === 'ORCA' ? 'OCC' : 'occ'))

const PROTECTED_DIRS = new Set(['.git', 'node_modules'])
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|icns|pdf|zip|gz|tgz|mp4|mov|webm|mp3|wav|woff2?|ttf|otf|node|wasm|jar|so|dylib|dll|exe|class|bin|p12|cer|crt|keystore|sqlite3?|db|tar|7z|rar|bmp|tiff?|psd|sketch|fig|xlsx|docx|pptx|heic)$/i

function isTracked(rel) {
  try {
    execFileSync('git', ['-C', target, 'ls-files', '--error-unmatch', rel], { stdio: 'ignore' })
    return true
  } catch {
    try {
      return execFileSync('git', ['-C', target, 'ls-files', `${rel}/`], { encoding: 'utf8' }).trim().length > 0
    } catch {
      return false
    }
  }
}

let renamed = 0
function renameTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PROTECTED_DIRS.has(entry.name)) continue
    const oldAbs = path.join(dir, entry.name)
    const rel = path.relative(target, oldAbs)
    if (/orca/i.test(entry.name)) {
      if (!isTracked(rel)) continue
      const newAbs = path.join(dir, map(entry.name))
      if (fs.existsSync(newAbs)) {
        console.warn(`skip collision: ${rel}`)
        continue
      }
      execFileSync('git', ['-C', target, 'mv', rel, path.relative(target, newAbs)], {
        stdio: 'inherit'
      })
      renamed++
      if (entry.isDirectory()) renameTree(newAbs)
    } else if (entry.isDirectory()) {
      renameTree(oldAbs)
    }
  }
}

renameTree(target)

const files = git('ls-files', '-z').split('\0').filter(Boolean)
const replacements = [
  ['https://login.onocc.dev', 'https://login.onorca.dev'],
  ['https://relay.onocc.dev', 'https://relay.onorca.dev'],
  ['https://push.onocc.dev', 'https://push.onorca.dev'],
  ["'occ-desktop'", "'orca-desktop'"],
  ['x-occ-host-capabilities', 'x-orca-host-capabilities'],
  ['occ-relay-host-proof/v1', 'orca-relay-host-proof/v1'],
  ['occ-relay-host-challenge/v1', 'orca-relay-host-challenge/v1'],
  ['occ-push-host-proof/v1', 'orca-push-host-proof/v1'],
  ['occ-push-host-challenge/v1', 'orca-push-host-challenge/v1'],
  ['occ-mobile-e2ee', 'orca-mobile-e2ee'],
  ['occ:\\/\\/pair', 'orca:\\/\\/pair'],
  ['occ://pair', 'orca://pair']
]

let changed = 0
for (const rel of files) {
  if (SKIP_EXT.test(rel)) continue
  const abs = path.join(target, rel)
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    continue
  }
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) continue
  const buf = fs.readFileSync(abs)
  if (buf.subarray(0, 8192).includes(0)) continue
  const text = buf.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buf)) continue
  let next = text.replace(/orca/gi, (match) => (match === 'Orca' || match === 'ORCA' ? 'OCC' : 'occ'))
  // Only the shipped desktop code keeps production relay hosts and wire labels.
  if (rel.startsWith('src/main/') || rel.startsWith('src/shared/')) {
    for (const [from, to] of replacements) next = next.split(from).join(to)
  }
  if (next !== text) {
    fs.writeFileSync(abs, next)
    changed++
  }
}

console.log(`renamed paths: ${renamed}`)
console.log(`rewritten files: ${changed}`)
console.log('next: review diff, bump VERSION, run typecheck and build')
