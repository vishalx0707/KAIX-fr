$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot "images\pin_915145586798628428"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$urls = @(
  "https://i.pinimg.com/originals/17/71/cc/1771cc6eb842543bf81a513e4c073c60.jpg",
  "https://i.pinimg.com/originals/11/d3/a0/11d3a0e93617550180fe12eb2e8641ee.jpg",
  "https://i.pinimg.com/originals/8d/a0/8c/8da08c368846c271c0509bf253817817.jpg",
  "https://i.pinimg.com/originals/7a/1c/03/7a1c03dc798bed415837351dba1dd9e2.jpg",
  "https://i.pinimg.com/originals/44/5a/64/445a64a4a65c0b02477b4b256628bb15.jpg",
  "https://i.pinimg.com/originals/d2/0d/4c/d20d4cd94d81f6fc3dc1fe46c21f0b62.jpg",
  "https://i.pinimg.com/originals/fb/8b/48/fb8b48bb48c2938a7a98b584ee775953.jpg",
  "https://i.pinimg.com/originals/a6/d2/b6/a6d2b6a970f4e80b1b1f02079e252136.jpg",
  "https://i.pinimg.com/originals/63/54/a1/6354a13925faca46485bbecd24ea349d.jpg",
  "https://i.pinimg.com/originals/ad/22/4b/ad224bf922d98db90f3792792af783ed.jpg",
  "https://i.pinimg.com/originals/c6/f8/78/c6f878fa1220705483695e118864749d.jpg",
  "https://i.pinimg.com/originals/78/6c/49/786c493f231f7be26c7fb76f9bc6574a.jpg",
  "https://i.pinimg.com/originals/85/02/7c/85027c55e54aaf89f2a77e2c1459896e.jpg",
  "https://i.pinimg.com/originals/77/cc/47/77cc47f007a887abb2b4bb60dc8a67ee.png",
  "https://i.pinimg.com/originals/32/9a/71/329a71545c1a37bf151401b956b974c7.jpg",
  "https://i.pinimg.com/originals/b0/0e/6a/b00e6a6e477dca1f05f7050085713330.jpg",
  "https://i.pinimg.com/originals/7a/de/b1/7adeb117bc47acd928bd3c90af9442fb.jpg",
  "https://i.pinimg.com/originals/14/8f/fb/148ffb13ff375652d8909deb797c449e.jpg",
  "https://i.pinimg.com/originals/59/6e/e5/596ee5472dd8df2bff4c796ad9dc4296.jpg",
  "https://i.pinimg.com/originals/d4/25/97/d42597d33129fdd75c183bea1cba37b1.jpg",
  "https://i.pinimg.com/originals/1b/d6/46/1bd646422478abbfbbfeaf546f6f761a.jpg",
  "https://i.pinimg.com/originals/a8/5a/97/a85a972b8df99e45224e2b3668198bb8.jpg",
  "https://i.pinimg.com/originals/9e/74/8e/9e748eb8ae264ca7307663bf582ee66f.jpg",
  "https://i.pinimg.com/originals/b8/da/40/b8da401a64ba1fd5f57ddb66d7c424e9.jpg",
  "https://i.pinimg.com/originals/e2/e2/d8/e2e2d898fbdd69d87efb27534bc82165.jpg",
  "https://i.pinimg.com/originals/c5/fb/96/c5fb9615105f047794ba984f7f9884f6.jpg",
  "https://i.pinimg.com/originals/24/2c/0f/242c0f783d9af7c11847d4d3aa188a77.jpg",
  "https://i.pinimg.com/originals/05/66/30/056630348e16d70ef4a6dbd566cd4b48.jpg",
  "https://i.pinimg.com/originals/82/88/db/8288db32af5a5cef7e859d2a9f85587d.jpg"
)

$headers = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" }
$i = 0
$ok = 0
$fail = 0
foreach ($u in $urls) {
  $i++
  $hash = ($u -split '/')[-1].Split('.')[0]
  $ext = ($u -split '\.')[-1]
  $num = "{0:D2}" -f $i
  $out = Join-Path $dir "$num`_$hash.$ext"
  $downloaded = $false
  foreach ($candidate in @($u, ($u -replace '/originals/', '/736x/'))) {
    try {
      Invoke-WebRequest -Uri $candidate -OutFile $out -Headers $headers -TimeoutSec 30
      if ((Get-Item $out).Length -gt 1000) { $downloaded = $true; break }
    } catch { }
  }
  if ($downloaded) { $ok++; Write-Host "OK  $num  $hash" }
  else { $fail++; Write-Host "FAIL $num  $hash" }
}
Write-Host "`nDONE: $ok saved, $fail failed, into $dir"
