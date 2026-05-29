$urls = @(
  "7b/63/10/7b6310ffa978421dbc1daf8766ded931",
  "fd/b6/b5/fdb6b564e0e8130ebe7175be6f48368b",
  "d9/43/12/d94312f122a42bf162789c23bddb9adf",
  "dd/86/c2/dd86c27eae4495ece2335525cd046f4b",
  "18/07/39/180739fd98fcf30f33b5abb0e3197fb8",
  "eb/9e/6e/eb9e6e25c0b5d6a3ca33c909a083f1c5",
  "4b/ea/0d/4bea0d5043404106b42904ef19778003",
  "1a/a0/d0/1aa0d0bbe5ba89eeca1782b24bfb5486",
  "28/de/14/28de142696020b64f8cc293b93bc8aaf",
  "87/3f/86/873f8658ecd94aadd07a192fab4a7562",
  "3d/63/4a/3d634a1627346253e267240ed73b9dca",
  "79/29/e3/7929e30a45c7697bbd97dea28d88c692",
  "16/9f/ce/169fce4927f65cd741ea34a046528444",
  "1d/18/a2/1d18a28fdd7fbae8765dfb98434ac16a",
  "ce/a7/01/cea701fe57cf37f704ef8751bf2ce71a",
  "4f/c8/08/4fc808348a5b325a5a5d856e4e306c75",
  "36/b1/3c/36b13cc1dc3a4f22f3cdba12f3b7538f",
  "9f/2e/23/9f2e23ef70e591c4464c8ee8bfa8157d",
  "ca/63/d3/ca63d394cf5da49bd79669711fbddbb2",
  "f4/51/21/f451211776fde60b54ad258690234b17",
  "c7/8b/4b/c78b4b801f7a481981d5ea4771d40b31",
  "ab/54/34/ab5434bcca931dd592d11414c4db077a",
  "69/71/55/697155252599743d9e4ae471f6825aea",
  "86/ec/18/86ec18a06f430ab04a672f1c7a6a81d7",
  "d1/d0/b0/d1d0b0822d111e09f41cdfc63c905b29",
  "73/31/5b/73315b27fbef835b7c9587b4ee51eab1",
  "67/79/28/677928af12a6c592a6356b4d511aac2e",
  "ad/3f/11/ad3f114200c66750e54dcdafaf3de449",
  "f4/5c/0d/f45c0d39e867169bac53c3f6b99319ff",
  "6e/b2/c8/6eb2c84edbc34f4569df48b34261b8f7"
)

$outDir = Join-Path $PSScriptRoot "images\grainy_cinematic"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$i = 0
foreach ($u in $urls) {
  $i++
  $hash = ($u -split '/')[-1]
  $outFile = Join-Path $outDir ("{0:D2}_{1}.jpg" -f $i, $hash)
  # Try originals first, fall back to 736x
  $ok = $false
  foreach ($size in @("originals", "736x")) {
    $url = "https://i.pinimg.com/$size/$u.jpg"
    try {
      Invoke-WebRequest -Uri $url -OutFile $outFile -UserAgent "Mozilla/5.0" -ErrorAction Stop
      $ok = $true
      break
    } catch {}
  }
  if ($ok) { Write-Host "[$i/30] $hash" } else { Write-Host "[$i/30] FAILED $hash" }
}

Write-Host "Done. Saved to $outDir"
Get-ChildItem $outDir | Measure-Object | Select-Object Count
