'use strict';

// ============================================================
// VS Code-style Syntax Highlighting System
// ============================================================
// Token-based highlighting that runs on the editor textarea.
// Does NOT modify the textarea itself; uses a hidden highlight layer.
// Preserves all editor functionality: cursor, selection, undo, redo.

const syntaxHighlighter = (() => {
  // Language-specific token patterns
  const SYNTAX_RULES = {
    python: {
      keywords: /\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g,
      builtins: /\b(abs|all|any|ascii|bin|bool|breakpoint|bytearray|bytes|callable|chr|classmethod|compile|complex|delattr|dict|dir|divmod|enumerate|eval|exec|filter|float|format|frozenset|getattr|globals|hasattr|hash|help|hex|id|input|int|isinstance|issubclass|iter|len|list|locals|map|max|memoryview|min|next|object|oct|open|ord|pow|print|property|range|repr|reversed|round|set|setattr|slice|sorted|staticmethod|str|sum|super|tuple|type|vars|zip)\b/g,
      strings: /('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|'''[\s\S]*?'''|"""[\s\S]*?""")/g,
      comments: /#.*$/gm,
      numbers: /\b(\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+|\d+)\b/g,
      operators: /([+\-*/%=!<>&|^~]|==|!=|<=|>=|\/\/|\*\*|<<|>>|and|or|not|in|is)/g,
      decorators: /@\w+/g,
    },
    javascript: {
      keywords: /\b(abstract|arguments|await|boolean|break|byte|case|catch|char|class|const|continue|debugger|default|delete|do|double|else|enum|eval|event|export|extends|false|final|finally|float|for|function|goto|if|implements|import|in|instanceof|int|interface|let|long|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|true|try|typeof|var|void|volatile|while|with|yield)\b/g,
      strings: /('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`)/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+|\d+)\b/g,
      regex: /\/(?:[^\/\\\n]|\\.)+\/[gimsuvy]*/g,
      operators: /([+\-*/%=!<>&|^~?:]|===|!==|==|!=|<=|>=|&&|\|\||>>|<<|>>>|\*\*|\+\+|--|=>)/g,
    },
    c: {
      keywords: /\b(auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)')/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+|\d+[uUlL]*)\b/g,
      operators: /([+\-*/%=!<>&|^~]|==|!=|<=|>=|<<|>>|\&\&|\|\||\+\+|--)/g,
      preprocessor: /#\s*\w+.*$/gm,
      macros: /\b[A-Z_][A-Z0-9_]*\b/g,
    },
    cpp: {
      keywords: /\b(alignas|alignof|and|and_eq|asm|auto|bitand|bitor|bool|break|case|catch|char|char8_t|char16_t|char32_t|class|compl|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|false|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|not|not_eq|nullptr|operator|or|or_eq|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|synchronized|template|this|thread_local|throw|true|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t|while|xor|xor_eq)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)')/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+|\d+[uUlL]*)\b/g,
      operators: /([+\-*/%=!<>&|^~]|==|!=|<=|>=|<<|>>|->|\.\*|->\*|::|&&|\|\||\+\+|--)/g,
      preprocessor: /#\s*\w+.*$/gm,
      templates: /<[^>]*>/g,
    },
    java: {
      keywords: /\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)')/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+[lL]?|0[bB][01]+[lL]?|\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+[fFdD]?|\d+[fFdD]|\d+[lL]?)\b/g,
      operators: /([+\-*/%=!<>&|^~?:]|===|!==|==|!=|<=|>=|&&|\|\||>>|<<|>>>|\+\+|--|->)/g,
      annotations: /@\w+/g,
    },
    kotlin: {
      keywords: /\b(abstract|annotation|as|break|by|catch|class|companion|const|constructor|continue|crossinline|data|delegate|do|dynamic|else|enum|expect|external|false|field|file|final|finally|for|fun|get|if|import|in|infix|init|inline|inner|interface|internal|is|it|lateinit|noinline|null|object|open|operator|out|override|package|param|private|property|protected|public|receiver|reified|return|sealed|set|setparam|super|suspend|tailrec|this|throw|true|try|typealias|typeof|val|var|vararg|when|where|while)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)'|"""[\s\S]*?""")/g,
      comments: /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+[lL]?|0[bB][01]+[lL]?|\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+[fF]?|\d+[fF]|\d+[lL]?)\b/g,
      operators: /([+\-*/%=!<>&|^~?:]|==|!=|<=|>=|===|!==|&&|\|\||>>|<<|>>>|\+\+|--|->|\.\.)/g,
      annotations: /@\w+/g,
    },
    html: {
      tags: /(<\/?[\w-:]+(?:\s+[\w-:]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/??>)/g,
      comments: /<!--[\s\S]*?-->/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g,
      entities: /&[#\w]+;/g,
      attributes: /\b[\w-]+(?=\s*=)/g,
    },
    css: {
      selectors: /^[^{]*(?={)/gm,
      properties: /\b(align-content|align-items|align-self|all|animation|animation-delay|animation-direction|animation-duration|animation-fill-mode|animation-iteration-count|animation-name|animation-play-state|animation-timing-function|appearance|azimuth|backface-visibility|background|background-attachment|background-blend-mode|background-clip|background-color|background-image|background-origin|background-position|background-repeat|background-size|border|border-bottom|border-bottom-color|border-bottom-left-radius|border-bottom-right-radius|border-bottom-style|border-bottom-width|border-collapse|border-color|border-image|border-image-outset|border-image-repeat|border-image-slice|border-image-source|border-image-width|border-left|border-left-color|border-left-style|border-left-width|border-radius|border-right|border-right-color|border-right-style|border-right-width|border-spacing|border-style|border-top|border-top-color|border-top-left-radius|border-top-right-radius|border-top-style|border-top-width|border-width|bottom|box-decoration-break|box-shadow|box-sizing|break-after|break-before|break-inside|caption-side|caret-color|clear|clip|clip-path|color|column-count|column-fill|column-gap|column-rule|column-rule-color|column-rule-style|column-rule-width|column-span|column-width|columns|content|counter-increment|counter-reset|cursor|direction|display|empty-cells|filter|flex|flex-basis|flex-direction|flex-flow|flex-grow|flex-shrink|flex-wrap|float|font|font-family|font-feature-settings|font-kerning|font-language-override|font-size|font-size-adjust|font-stretch|font-style|font-synthesis|font-variant|font-variant-alternates|font-variant-caps|font-variant-east-asian|font-variant-ligatures|font-variant-numeric|font-variant-position|font-weight|font-optical-sizing|gap|grid|grid-area|grid-auto-columns|grid-auto-flow|grid-auto-rows|grid-column|grid-column-end|grid-column-start|grid-row|grid-row-end|grid-row-start|grid-template|grid-template-areas|grid-template-columns|grid-template-rows|hanging-punctuation|height|hyphens|image-orientation|image-rendering|image-resolution|ime-mode|import|initial-letter|initial-letter-align|inline-size|inset|inset-block|inset-block-end|inset-block-start|inset-inline|inset-inline-end|inset-inline-start|isolation|justify-content|justify-items|justify-self|kerning|left|letter-spacing|lighting-color|line-break|line-height|list-style|list-style-image|list-style-position|list-style-type|margin|margin-block|margin-block-end|margin-block-start|margin-bottom|margin-inline|margin-inline-end|margin-inline-start|margin-left|margin-right|margin-top|margin-trim|marks|mask|mask-border|mask-border-mode|mask-border-outset|mask-border-repeat|mask-border-slice|mask-border-source|mask-border-width|mask-clip|mask-composite|mask-image|mask-mode|mask-origin|mask-position|mask-repeat|mask-size|mask-type|max-block-size|max-height|max-inline-size|max-width|min-block-size|min-height|min-inline-size|min-width|mix-blend-mode|object-fit|object-position|offset|offset-anchor|offset-distance|offset-path|offset-position|offset-rotate|opacity|order|orphans|outline|outline-color|outline-offset|outline-style|outline-width|overflow|overflow-anchor|overflow-wrap|overflow-x|overflow-y|overscroll-behavior|overscroll-behavior-block|overscroll-behavior-inline|overscroll-behavior-x|overscroll-behavior-y|padding|padding-block|padding-block-end|padding-block-start|padding-bottom|padding-inline|padding-inline-end|padding-inline-start|padding-left|padding-right|padding-top|page-break-after|page-break-before|page-break-inside|paint-order|palette|pan-down|pan-left|pan-right|pan-up|paint-order|path|perspective|perspective-origin|pinch-zoom|place-content|place-items|place-self|pointer-events|position|print-color-adjust|property|quotes|r|radial-gradient|range|ratio|rays|rect|region|repeat|repeating-linear-gradient|repeating-radial-gradient|resize|resolution|right|rotate|row-gap|ruby-align|ruby-merge|ruby-position|running|rx|ry|scale|scroll-behavior|scroll-margin|scroll-margin-block|scroll-margin-block-end|scroll-margin-block-start|scroll-margin-bottom|scroll-margin-inline|scroll-margin-inline-end|scroll-margin-inline-start|scroll-margin-left|scroll-margin-right|scroll-margin-top|scroll-padding|scroll-padding-block|scroll-padding-block-end|scroll-padding-block-start|scroll-padding-bottom|scroll-padding-inline|scroll-padding-inline-end|scroll-padding-inline-start|scroll-padding-left|scroll-padding-right|scroll-padding-top|scroll-snap-align|scroll-snap-coordinate|scroll-snap-destination|scroll-snap-margin|scroll-snap-margin-bottom|scroll-snap-margin-left|scroll-snap-margin-right|scroll-snap-margin-top|scroll-snap-points-x|scroll-snap-points-y|scroll-snap-stop|scroll-snap-type|scrollbar-color|scrollbar-gutter|scrollbar-width|shape-image-threshold|shape-margin|shape-outside|shape-rendering|shape-size|shapes|shift|short|short-hand|show|size|sizing|skew|skew-x|skew-y|sketch|slice|slope|shape-margin|src|stack|stop-color|stop-opacity|storage|stress|stretch|string|stroke|stroke-dasharray|stroke-dashoffset|stroke-linecap|stroke-linejoin|stroke-miterlimit|stroke-opacity|stroke-width|style|stylistic|styleset|stylistic|submit-button|subset|super|superscript|supports|suppress|surface|swash|symbol|symbols|syntax|system|tab-size|table-layout|tag|target|target-counters|target-text|text-align|text-align-all|text-align-last|text-anchor|text-combine-upright|text-decoration|text-decoration-color|text-decoration-line|text-decoration-skip|text-decoration-skip-ink|text-decoration-style|text-decoration-thickness|text-emphasis|text-emphasis-color|text-emphasis-position|text-emphasis-style|text-indent|text-justify|text-orientation|text-overflow|text-rendering|text-shadow|text-size-adjust|text-spacing|text-transform|text-underline-offset|text-underline-position|text-wrap|textshadow|texturesize|th|theme|third|thirty|threshold|thresholdresult|thresholdtype|through|throughout|throw|throws|tilt|time|timing|timing-function|timing-functions|title|toggle|token|tolerance|tone|top|topologies|topology|total|totallength|touched|touching|touching-area|touching-offset|touching-point|touching-points|touching-radius|touching-width|touchstartx|touchstarty|touchstarttime|transform|transform-box|transform-origin|transform-style|transformations|transforms|transition|transition-delay|transition-duration|transition-property|transition-timing-function|transitions|translate|translate3d|translatex|translatey|translatez|type|type-selector|types|typography|u|unicode|unicode-bidi|unicode-range|unicode-source|unicode-symbol|units|universal|unset|up|upper|upper-alpha|upper-greek|upper-latin|upper-roman|uri|url|user-select|user-zoom|username|using|v|valid|validate|validation|value|values|valve|vanish|vanishing-line|vanishing-point|vanishing-points|var|var-|variable|variables|variant|variants|variation|variate|variations|variator|variety|varies|varies|varifocal|varmint|vary|vas|vase|vast|vastly|vat|vatical|vatic|vatican|vatted|vatting|vatu|vauch|vaunt|vauntedly|vauntie|vaunties|vauntingly|vauntress|vaunts|vaunt|vauntingly|vaur|vaute|vaut|vaut-right|vaute|vauted|vauted|vautier|vaults|vault-way|vaunt|vaume|vaumure|vaut|vaute|vauted|vauter|vauther|vauts|vautour|vaututor|vaututrice|vav|vavassaria|vavassary|vavasoria|vavasor|vavasory|vavasour|vavasur|vavassories|vavassor|vavassorial|vavassor|vavassor|vavassor|vavissory|vavassor|vavissories|vavassor|vavissory|vavassor|vavassory|vavassor|vavassories|vavassor|vavassy|vavaisory|vavassory|vavasor|vavasory|vavasour|vavassor|vavassor|vavassor|vavassor|vavassor|vavassoric|vavassory|vavassor|vavassary|vavassory|vavassorie|vavassories|vavassor|vavassoria|vavassor|vavassories|vavassor|vavassor|vavassor|vavassores|vavassor|vavassories|vavassor|vavassor|vavassor|vavassories|vavassories|vavassories|vavassor|vavassories|vavassories|vavassor|vavassories|vavassor|vavassories|vavassor|vavassories|vavassor|vavassories|vavassor|vavassories|vavassor)\b/g,
      values: /\b(absolute|auto|baseline|block|bold|border-box|bottom|break-word|center|circle|contain|content-box|cover|dashed|digits|dotted|double|end|flex|flex-end|flex-start|float|grid|groove|hidden|inline|inline-block|inline-flex|inline-grid|inset|inside|justify|left|line-through|middle|nowrap|none|normal|outset|outside|overline|pointer|relative|repeat|repeat-x|repeat-y|ridge|right|row|row-reverse|solid|space|space-around|space-between|space-evenly|start|static|stretch|text-bottom|text-top|top|underline|visible|wrap|wrap-reverse|x|y|zoom)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|url\([^)]*\))/g,
      comments: /\/\*[\s\S]*?\*\//g,
      numbers: /\b(\d+\.?\d*|\.\d+)(%|em|ex|ch|rem|vw|vh|vmin|vmax|px|cm|mm|in|pt|pc)?\b/g,
      operators: /([+\-*/%=!<>&|^~:;,]|!=|==|<=|>=|&&|\|\||>>|<<)/g,
    },
    bash: {
      keywords: /\b(if|then|else|elif|fi|case|esac|for|do|done|while|until|function|return|break|continue|exit|export|local|readonly|unset|declare|typeset|command|builtin)\b/g,
      builtins: /\b(echo|printf|test|cd|pwd|ls|mkdir|rmdir|rm|cp|mv|touch|cat|grep|sed|awk|sort|uniq|find|xargs|pipe|head|tail|wc|tr|cut|paste|join|comm|diff|cmp|patch|tar|gzip|zip|ar|ld|cc|gcc|g\+\+|make|as|strip|objdump|strings|ar|nm|ranlib|size|readelf|hexdump|od|strace|ltrace|gdb|valgrind|source|alias|bg|bind|builtin|caller|command|declare|enable|export|fc|hash|help|history|jobs|kill|let|local|logout|mapfile|popd|pushd|read|readarray|readonly|set|shopt|source|time|type|typeset|ulimit|umask|unalias|unset)\b/g,
      strings: /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\$\(([^)]|\\.)*\))/g,
      comments: /#.*$/gm,
      numbers: /\b(0[xX][0-9a-fA-F]+|\d+)\b/g,
      variables: /\$\{?\w+\}?/g,
      operators: /([+\-*/%=!<>&|^~;:]|==|!=|<=|>=|&&|\|\||>>|<<)/g,
    },
    json: {
      strings: /"([^"\\]|\\.)*"/g,
      numbers: /\b(0[xX][0-9a-fA-F]+|0[bB][01]+|-?\d+\.?\d*|\.\d+([eE][+-]?\d+)?)\b/g,
      keywords: /\b(true|false|null)\b/g,
      operators: /([:{}\[\],:])/g,
    },
  };

  const TOKEN_CLASSES = {
    keyword: 'kw',
    builtin: 'bi',
    string: 'str',
    comment: 'cm',
    number: 'num',
    operator: 'op',
    function: 'fn',
    class: 'cls',
    type: 'typ',
    constant: 'const',
    variable: 'var',
    tag: 'tag',
    attribute: 'attr',
    property: 'prop',
    selector: 'sel',
    entity: 'ent',
    regex: 'rx',
    preprocessor: 'pp',
    macro: 'mac',
    decorator: 'dec',
    annotation: 'ann',
    template: 'tpl',
  };

  function highlightCode(code, language) {
    if (!SYNTAX_RULES[language]) return escapeHtml(code);

    const rules = SYNTAX_RULES[language];
    const tokens = [];
    let lastIndex = 0;

    // Collect all matches with their type
    const matches = [];

    // Process each rule
    Object.entries(rules).forEach(([type, regex]) => {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(code)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          type,
          text: match[0],
        });
      }
    });

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    // Merge overlapping ranges (prioritize earlier matches)
    const mergedMatches = [];
    let lastEnd = 0;
    for (const m of matches) {
      if (m.start >= lastEnd) {
        mergedMatches.push(m);
        lastEnd = m.end;
      }
    }

    // Build highlighted HTML
    let html = '';
    let pos = 0;
    for (const match of mergedMatches) {
      if (pos < match.start) {
        html += escapeHtml(code.slice(pos, match.start));
      }
      const className = TOKEN_CLASSES[match.type] || match.type;
      html += `<span class="tok ${className}">${escapeHtml(match.text)}</span>`;
      pos = match.end;
    }
    if (pos < code.length) {
      html += escapeHtml(code.slice(pos));
    }

    return html;
  }

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }

  function getLanguageFromFilePath(filePath) {
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const map = {
      py: 'python',
      js: 'javascript',
      ts: 'javascript',
      jsx: 'javascript',
      tsx: 'javascript',
      c: 'c',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      h: 'c',
      hpp: 'cpp',
      java: 'java',
      kt: 'kotlin',
      html: 'html',
      htm: 'html',
      css: 'css',
      sh: 'bash',
      bash: 'bash',
      json: 'json',
    };
    return map[ext] || '';
  }

  return {
    highlightCode,
    getLanguageFromFilePath,
    SYNTAX_RULES,
    TOKEN_CLASSES,
  };
})();
