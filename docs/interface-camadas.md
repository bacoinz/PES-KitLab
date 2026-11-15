# Interface de camadas ao estilo PES Master (especificação)

Vistoria feita à interface pública do PES Master Kit Creator (2026-11-12). Só a lista de funções, campos e
intervalos: o código, as imagens (gráficos, padrões) e os modelos deles **não** são copiados; tudo é feito de raiz.

## Lista de camadas (por peça: camisola, calções, meias)

- Topo: seletor do modelo de gola (ex.: "Collar 3") que abre uma grelha de golas.
- Linhas compactas, a de cima fica por cima: 👁 visibilidade · amostra(s) de cor · ícone do tipo · nome · ícone
  "usar como máscara" · ✕. Clicar na linha abre o painel da camada (popover/inline).
- Linhas fixas no fim (não apagáveis): Gola, Mangas (cor das mangas, pode ficar oculta), Braçadeira de capitão, Base.
  Camisola também tem por omissão: Painéis de ombro, Painéis laterais, Painéis das mangas, Logos das mangas,
  Gola da frente.
- **ADICIONAR CAMADA** (grelha 2 colunas): Design base · Desenho livre · Gráfico · Padrão · Texto ·
  Padrão personalizado · Logo · Punhos · Painéis laterais · Painéis de ombro · Grupo.
  Calções e meias: Design base · Desenho livre · Gráfico · Padrão · Texto · Padrão personalizado · Logo · Grupo
  (+ linhas fixas Base, Bainha/Remate, Logos, Dobra).

## Campos comuns (no fim de cada painel)

Visualização: Standard | Livre · Frente · Costas · Mangas · Só nas mangas curtas — Desfoque 0..100 —
Opacidade 0..100 — Modo de mistura (Normal │ Escurecer, Multiplicar, Queimar cor │ Aclarar, Ecrã, Subexpor cor │
Sobrepor, Luz suave, Luz forte │ Diferença, Exclusão │ Matiz, Saturação, Cor, Luminosidade) —
Brilho próprio (interruptor + valor) — Máscara (lista de camadas) — Nome — Aleatório.

Pedido do utilizador: **tamanhos 10..800 (por omissão 100)**, **rotação −180..180 (0, com encaixe suave a cada 45°)**,
**deslocamentos −500..500** com Espelhar · Espelhar ao centro · Espelhar nas costas.

## Por tipo

- **Design base** — cada design tem campos próprios (intervalos do site):
  - Retângulo / Triângulo / Círculo: Contorno (interruptor), Largura 1..900, Altura 1..900, Arredondamento 0..100,
    Deslocamento x −500..500, y −600..600, Rotação, Espelhar ao centro, Espelhar nas costas.
  - Padrão de formas: Forma, Contorno, Largura/Altura 1..800, Arredondamento, Rotação da forma, Achatamento −100..100,
    Distância −50..800, Proporção da distância −100..100, Rotação, Deslocamento x/y −500..500,
    Disposição ∈ Desfasada | Desfasada na vertical | Grelha | Grelha alternada, Espelhar, Espelhar ao centro, nas costas.
  - Risca única: Largura 1..900, Rotação, Deslocamento −100..100, espelhos, **Borda ∈ Reta | Zigue-zague | Ondas**.
  - Risca com borda: Largura, Largura da borda 1..150, Distância 0..150, Rotação, Deslocamento, espelhos.
  - Risca de 2 cores: Largura, Distância 0..300, Rotação, Deslocamento, espelhos, Borda.
    3 cores: + Largura da transição 1..300. 4 cores: + Distância 1/2. 5 cores: + Largura da transição 1/2.
  - Riscas / Riscas (2 cores) / (3 cores): Largura 1..350, Distância 0..350, Deslocamento, Deslocamento x −300..300,
    Contagem 0..10, Rotação, [Espaço entre], espelhos, **Modo ∈ Sem risca central | Com risca central |
    Desfasado (esq.) | Desfasado (dir.)**, Borda. Riscas com separador: + Largura do separador 1..100,
    Distância do separador −20..100.
  - Degradê: Rotação, Suavidade 0..100, Deslocamento, Inverter, espelhos.
    Degradê multicor: paragens de cor com Posição 0..100, Rotação, Deslocamento.
    Degradê radial: paragens, Centro x/y −100..100, Raio interior 0..100, Raio exterior 1..200.
    Degradê meio-tom: Rotação, Tamanho do degradê 1..100, Suavidade, Deslocamento, Inverter.
    Meio-tom (pontos): Tamanho, Tamanho do elemento 5..32, Rotação, Modo, Deslocamento,
    Forma ∈ Quadrado | Losango | Círculo | Triângulo. Degradê em degraus: Tamanho 10..250, Tamanho do degradê, Inverter.
  - Xadrez: Tamanho 4..500, Proporção da largura, Deslocamento, Rotação, Linhas 0..20, Colunas 0..20,
    Modo ∈ Centrado | Desfasado (esq.) | (dir.).
  - Zigue-zague / Ondas: Largura, Distância, Deslocamento, Deslocamento x, Contagem 0..10, Profundidade −300..300,
    Passos, Rotação, Modo (como as riscas).
  - Cruz: Largura 10..500, Deslocamento x/y −500..500, Rotação. Cruz (2 cores) [v2]: + Distância 0..50, [Lados].
- **Gráfico**: biblioteca de desenhos completos com várias cores (categorias: Riscas, Listas, Degradê, Faixa,
  Padrão, Metades, Risca única, Gola, Mangas, Lista única, Chevron, Xadrez, Cruz, Quartos, Cor inteira…).
- **Padrão**: biblioteca de motivos P&B (Geométrico, Grunge, Riscas, Abstrato, Natureza, Zigue-zague, Xadrez,
  Grelha, Ondas, Mosaico, Camuflado, Pontos, Chevrons, Animal, Tipografia, Mármore…). Tamanho 10..800,
  Proporção da altura −100..100, Rotação, Deslocamento x/y −500..500, Espelhar, Espelhar ao centro, Espelhar nas costas.
- **Texto**: Fonte (com pré-visualização), Texto, Tamanho, Tamanho x, Tamanho y, Espaçamento de letras −50..1000,
  Arco −150..150, Itálico, Contorno + espessura 1..8, Posição ∈ Frente, Costas, Manga esq., Manga dir.,
  Ambas as mangas, Ambas espelhadas, Ambas invertidas, Lado dir., Lado esq., Lados, Lados espelhados,
  Lados espelhados invertidos, Braçadeira, Gola de trás. Posição x/y, Rotação.
- **Painéis laterais / de ombro / punhos**: Largura, Brilho próprio, Nome.

## Amostras de cor e seletor de cor

Na linha da camada: uma amostra por cor do design. Clicar abre o seletor: separadores **Predefinido** (linha de
cinzentos + grelha de 6×9 tons) e **Predefinições** (biblioteca de cores com nome, com pesquisa — no nosso caso:
cores das equipas do jogo e as que o utilizador guardar), quadrado saturação/brilho, barra de matiz e de brilho,
cor anterior vs nova, hex, conta-gotas (também do ecrã), **Cancelar · Aplicar a todos (onde esta cor é usada) · Aplicar**.

## Freeform (desenho vetorial, estilo Illustrator compacto)

Barra: Selecionar · Caneta · Anular · Refazer · Formas · Curva/suavizar ponto · Apagar ponto · Espelhar ·
Alinhar · Grelha · Íman (encaixe) · Afastar · Aproximar · Ajustar · Borracha · Repor. Tela com grelha, caixa
delimitadora, pontos (âncoras) clicáveis; o polígono fecha-se e é preenchido. Fica uma camada com as opções comuns.

## Punhos, painéis laterais e de ombro

Largura, Brilho próprio, Nome.

## Aba Logos

Marca (carregar · biblioteca · nome com ✕) com Camisola / Calções / Meias (cada um com cor e posição);
Equipa · Patrocínio · Patrocínio das costas · Manga (esq.) · Manga (dir.), cada um com carregar e biblioteca;
"Posicionamento livre". (Nós mantemos o que já temos — tamanhos, cores, posição livre na vista 2D.)

## Aba Números e nome

Impressão (ligado), Fonte, Cor, Contorno + espessura 1..8, Número, Tamanho 50..150, Deslocamento −100..200,
Nome, Número da frente, Brilho próprio, Número nos calções.
Nossos extras a manter: conjuntos de números do jogo, recolorir, fontes do PC, ficheiro FTEX.

## Definições da vista 3D

Modelo 3D, Esconder calções, Camisola por dentro, **Luz** ∈ HDRI | Estúdio | Padrão 1/2/3 | Noite | Dia | Dia (dir.) |
Dia (esq.) | Dia 2 | Escuro (dir.) | Escuro (esq.), ambiente HDRI, Profundidade de campo.
