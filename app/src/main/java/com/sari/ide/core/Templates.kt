package com.sari.ide.core

object Templates {
    data class Template(val language: String, val runFile: String, val files: Map<String, String>)

    val all: Map<String, Template> = mapOf(
        "python" to Template("python", "main.py", mapOf(
            "main.py" to "print(\"Hello from SARI IDE\")\n"
        )),
        "javascript" to Template("javascript", "main.js", mapOf(
            "main.js" to "console.log(\"Hello from SARI IDE\");\n"
        )),
        "html" to Template("html", "index.html", mapOf(
            "index.html" to """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My page</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello from SARI IDE</h1>
  <script src="script.js"></script>
</body>
</html>
""",
            "style.css" to "body { font-family: sans-serif; padding: 16px; }\n",
            "script.js" to "console.log('ready');\n"
        )),
        "c" to Template("c", "main.c", mapOf(
            "main.c" to """#include <stdio.h>

int main(void) {
    printf("Hello from SARI IDE\n");
    return 0;
}
"""
        )),
        "cpp" to Template("cpp", "main.cpp", mapOf(
            "main.cpp" to """#include <iostream>

int main() {
    std::cout << "Hello from SARI IDE" << std::endl;
    return 0;
}
"""
        )),
        "java" to Template("java", "Main.java", mapOf(
            "Main.java" to """public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from SARI IDE");
    }
}
"""
        )),
        "kotlin" to Template("kotlin", "Main.kt", mapOf(
            "Main.kt" to "fun main() {\n    println(\"Hello from SARI IDE\")\n}\n"
        )),
        "rust" to Template("rust", "main.rs", mapOf(
            "main.rs" to "fn main() {\n    println!(\"Hello from SARI IDE\");\n}\n"
        )),
        "go" to Template("go", "main.go", mapOf(
            "main.go" to "package main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"Hello from SARI IDE\")\n}\n"
        )),
        "typescript" to Template("typescript", "main.ts", mapOf(
            "main.ts" to "console.log(\"Hello from SARI IDE\");\n"
        )),
        "php" to Template("php", "main.php", mapOf(
            "main.php" to "<?php\necho \"Hello from SARI IDE\\n\";\n"
        )),
        "ruby" to Template("ruby", "main.rb", mapOf(
            "main.rb" to "puts \"Hello from SARI IDE\"\n"
        )),
        "lua" to Template("lua", "main.lua", mapOf(
            "main.lua" to "print(\"Hello from SARI IDE\")\n"
        )),
        "dart" to Template("dart", "main.dart", mapOf(
            "main.dart" to "void main() {\n  print('Hello from SARI IDE');\n}\n"
        )),
        "perl" to Template("perl", "main.pl", mapOf(
            "main.pl" to "print \"Hello from SARI IDE\\n\";\n"
        )),
        "bash" to Template("bash", "main.sh", mapOf(
            "main.sh" to "#!/bin/sh\necho \"Hello from SARI IDE\"\n"
        )),
        "empty" to Template("text", "README.md", emptyMap())
    )
}
