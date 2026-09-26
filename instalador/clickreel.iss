; Instalador do ClickReel (Inno Setup 6).
; Gerado automaticamente pelo GitHub Actions (.github/workflows/instalador.yml).
; Para gerar à mão no Windows, veja instalador/COMO-GERAR.txt

#define MeuApp "ClickReel"
#ifndef Versao
  #define Versao "1.0.0"
#endif

[Setup]
AppId={{8C1F7E52-3A4B-4B77-9E2D-5D6A1C0E9F31}
AppName={#MeuApp}
AppVersion={#Versao}
AppVerName={#MeuApp} {#Versao}
AppPublisher=Editora Heras
DefaultDirName={localappdata}\Programs\ClickReel
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ClickReel-Setup-{#Versao}
SetupIconFile=..\clickreel.ico
UninstallDisplayIcon={app}\clickreel.ico
UninstallDisplayName={#MeuApp}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalho"; Description: "Criar ícone na Área de Trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "..\server.js";        DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json";     DestDir: "{app}"; Flags: ignoreversion
Source: "..\clickreel.ico";      DestDir: "{app}"; Flags: ignoreversion
Source: "..\LEIA-ME.txt";      DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\lib\*";            DestDir: "{app}\lib";          Flags: ignoreversion recursesubdirs
Source: "..\public\*";         DestDir: "{app}\public";       Flags: ignoreversion recursesubdirs
Source: "..\demo\*";           DestDir: "{app}\demo";         Flags: ignoreversion recursesubdirs
Source: "..\node_modules\*";   DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\navegadores\*";    DestDir: "{app}\navegadores";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\node\node.exe"; DestDir: "{app}\node";      Flags: ignoreversion
; roteiros de exemplo: não sobrescreve os que você já editou
Source: "..\roteiros\*";       DestDir: "{app}\roteiros";     Flags: onlyifdoesntexist

[Dirs]
Name: "{app}\videos"
Name: "{app}\musicas"

[Icons]
Name: "{autoprograms}\{#MeuApp}";            Filename: "{app}\node\node.exe"; Parameters: "server.js"; WorkingDir: "{app}"; IconFilename: "{app}\clickreel.ico"; Comment: "Grava vídeos de demonstração do site"
Name: "{autodesktop}\{#MeuApp}";             Filename: "{app}\node\node.exe"; Parameters: "server.js"; WorkingDir: "{app}"; IconFilename: "{app}\clickreel.ico"; Tasks: atalho
Name: "{autoprograms}\{#MeuApp} - Vídeos";   Filename: "{app}\videos"

[Run]
Filename: "{app}\node\node.exe"; Parameters: "server.js"; WorkingDir: "{app}"; Description: "Abrir o {#MeuApp} agora"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.gravacoes"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\navegadores"
