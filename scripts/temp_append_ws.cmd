$path = 'D:\AI BUILDING SAAS - Copy\AI BUILDING SAAS - Copy\packages\frontend\src\services\workspace-commands.ts'
$text = [System.IO.File]::ReadAllText($path)
$anchor = "return Math.round(floorArea / baseArea * 100);`r`n}`r`n"
$rest = $text.Substring($text.Length - $anchor.Length)
if ($rest -ne $anchor) {
    throw "anchor mismatch; tail=[" + $rest.Substring([Math]::Max(0,$text.Length-40)) + "]"
}
$append = @"

// ---- Image interpretation ----
export type WorkspaceCommandGroup = "Tools" | "Floors" | "Views" | "Selection" | "Generation" | "Project" | "Images";

export function commandImages(): readonly WorkspaceCommand[] {
  return [
    {
      id: "image-convert",
      label: "Convert image -> 2D",
      group: "Images",
      keywords: ["image", "convert", "extract", "interpret", "2d", "picture", "upload"],
    },
  ];
}

"@
[System.IO.File]::WriteAllText($path, $text.Insert($text.Length - $anchor.Length, $append))
Write-Output 'appended workspace-commands image exports'
