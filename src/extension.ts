import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "jsonschematodart.convertJsonSchema",
    async (uri: vscode.Uri | undefined) => {
      if (!uri || !uri.fsPath) {
        vscode.window.showErrorMessage(
          "Please run this command from the explorer context by right-clicking a folder."
        );
        return;
      }

      const clipboardContent = await vscode.env.clipboard.readText();
      if (!clipboardContent) {
        vscode.window.showErrorMessage("Clipboard is empty!");
        return;
      }

      try {
        const schema = JSON.parse(clipboardContent);
        const folderPath = uri.fsPath;

        const modelsFolder = path.join(folderPath, "models");
        if (!fs.existsSync(modelsFolder)) {
          fs.mkdirSync(modelsFolder);
        }

        generateModels(folderPath, schema, modelsFolder);
        vscode.window.showInformationMessage(
          "Dart models generated successfully!"
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error parsing JSON: ${error}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

function generateModels(folderPath: string, schema: any, outputDir: string) {
  if (!schema.definitions) {
    vscode.window.showErrorMessage("No definitions found in JSON schema.");
    return;
  }

  for (const [definitionName, definition] of Object.entries(
    schema.definitions
  )) {
    const folderName = toSnakeCase(definitionName);
    const modelFolderPath = path.join(outputDir, folderName);

    if (!fs.existsSync(modelFolderPath)) {
      fs.mkdirSync(modelFolderPath);
    }

    const fileName = `${folderName}.dart`;
    const filePath = path.join(modelFolderPath, fileName);

    const dartClassContent = generateDartClass(
      folderPath,
      definitionName,
      definition,
      schema.definitions
    );
    fs.writeFileSync(filePath, dartClassContent);
  }
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

function generateDartClass(
  folderPath: string,
  className: string,
  definition: any,
  definitions: any
): string {
  const dartClassName =
    toCamelCase(className).charAt(0).toUpperCase() +
    toCamelCase(className).slice(1);
  const properties = definition.properties || {};

  let imports = new Set<string>(); // Use a Set to avoid duplicate imports

  // Collect imports for nested models
  for (const [propName, propDef] of Object.entries(properties)) {
    const itemDef = propDef as any;
    if (itemDef.$ref) {
      const referencedType = itemDef.$ref.split("/").pop();
      imports.add(
        `${toSnakeCase(referencedType)}/${toSnakeCase(referencedType)}.dart`
      ); // Add the referenced model's filename
    } else if (itemDef.items && itemDef.items.$ref) {
      const referencedType = itemDef.items.$ref.split("/").pop();
      imports.add(
        `${toSnakeCase(referencedType)}/${toSnakeCase(referencedType)}.dart`
      ); // Add the referenced model's filename
    } else if (itemDef.enum) {
      imports.add(`enums/${toSnakeCase(propName)}.dart`);
    }
  }

  let classContent = `import 'dart:convert';\n`;

  // Add imports for referenced models
  imports.forEach((model) => {
    classContent += `import '../${model}';\n`; // Adjust the import path if necessary
  });

  classContent += `\nclass ${dartClassName} {\n`;

  // Define fields
  for (const [propName, propDef] of Object.entries(properties)) {
    const fieldName = toLowerCamelCase(propName);
    const fieldType = mapJsonSchemaTypeToDart(
      folderPath,
      propName,
      propDef,
      definitions
    );
    classContent += `  final ${fieldType}? ${fieldName};\n`;
  }

  // Constructor
  classContent += `\n  ${dartClassName}({\n`;
  for (const [propName] of Object.entries(properties)) {
    const fieldName = toLowerCamelCase(propName);
    classContent += `    this.${fieldName},\n`;
  }
  classContent += `  });\n`;

  // fromMap method
  classContent += `\n  factory ${dartClassName}.fromMap(Map<String, dynamic> json) {\n`;
  classContent += `    return ${dartClassName}(\n`;
  for (const [propName, propDef] of Object.entries(properties)) {
    const itemDef = propDef as any;
    const fieldName = toLowerCamelCase(propName);
    const fieldType = mapJsonSchemaTypeToDart(
      folderPath,
      propName,
      propDef,
      definitions
    );
    // Handle nested objects and lists
    if (fieldType.startsWith("List<")) {
      const itemType = fieldType.slice(5, -1);
      classContent += `      ${fieldName}: (json['${fieldName}'] as List)\n        .map((item) => ${itemType}.fromMap(item)).toList(),\n`;
    } else if (
      definitions[itemDef.$ref] &&
      definitions[itemDef.$ref.split("/").pop()]
    ) {
      classContent += `      ${fieldName}: ${fieldType}.fromMap(json['${fieldName}']),\n`;
    } else {
      classContent += `      ${fieldName}: json['${fieldName}'],\n`;
    }
  }
  classContent += `    );\n  }\n`;

  // toMap method
  classContent += `\n  Map<String, dynamic> toMap() {\n`;
  classContent += `    return {\n`;
  for (const [propName, propDef] of Object.entries(properties)) {
    const fieldName = toLowerCamelCase(propName);
    const fieldType = mapJsonSchemaTypeToDart(
      folderPath,
      propName,
      propDef,
      definitions
    );
    const itemDef = propDef as any;

    if (fieldType.startsWith("List<")) {
      const itemType = fieldType.slice(5, -1);
      classContent += `      if (${fieldName} != null) '${fieldName}': ${fieldName}!.map((item) => item.toMap()).toList(),\n`;
    } else if (
      definitions[itemDef.$ref] &&
      definitions[itemDef.$ref.split("/").pop()]
    ) {
      classContent += `      if (${fieldName} != null) '${fieldName}': ${fieldName}!.toMap(),\n`;
    } else {
      classContent += `      if (${fieldName} != null) '${fieldName}': ${fieldName},\n`;
    }
  }
  classContent += `    };\n  }\n`;

  // jsonEncode method
  classContent += `\n  String toJson() => jsonEncode(toMap());\n`;

  // jsonDecode factory method
  classContent += `\n  factory ${dartClassName}.fromJson(String jsonString) => ${dartClassName}.fromMap(jsonDecode(jsonString));\n`;

  // toString method
  classContent += `\n  @override\n  String toString() {\n`;
  classContent += `    return """${dartClassName}(\n`;
  for (const [propName] of Object.entries(properties)) {
    const fieldName = toLowerCamelCase(propName);
    classContent += `      '${fieldName}: \$${fieldName}',\n`;
  }
  classContent += `  )""";\n`;
  classContent += `  }\n`;

  // Equality operator
  classContent += `\n  @override\n  bool operator ==(Object other) {\n`;
  classContent += `    if (identical(this, other)) return true;\n`;
  classContent += `    if (other.runtimeType != runtimeType) return false;\n`;
  classContent += `    final ${dartClassName} typedOther = other as ${dartClassName};\n`;
  classContent += `    return ${Object.entries(properties)
    .map(
      ([propName]) =>
        `typedOther.${toLowerCamelCase(propName)} == ${toLowerCamelCase(
          propName
        )}`
    )
    .join(" &&\n      ")};\n`;
  classContent += `  }\n`;

  // hashCode method
  classContent += `\n  @override\n  int get hashCode {\n`;
  classContent += `    return ${Object.entries(properties)
    .map(([propName]) => `${toLowerCamelCase(propName)}.hashCode`)
    .join(" ^\n      ")};\n`;
  classContent += `  }\n`;

  classContent += "}\n";
  return classContent;
}

function toCamelCase(str: string): string {
  return str.replace(/_./g, (s) => s.charAt(1).toUpperCase());
}

function toLowerCamelCase(str: string): string {
  const camelCase = toCamelCase(str);
  return camelCase.charAt(0).toLowerCase() + camelCase.slice(1);
}

function generateEnum(enumName: string, enumValues: string[]): string {
  const dartEnumName =
    toCamelCase(enumName).charAt(0).toUpperCase() +
    toCamelCase(enumName).slice(1);
  const enumContent = `enum ${dartEnumName} {\n`;
  const values = enumValues
    .map((value) => `  ${convertString(value)},`)
    .join("\n");

  const toMap = `String toMap() {
  return this.toString().split('.').last;
  }`;
  const fromMap = `factory ${dartEnumName}.fromMap(String map) {

  return ${
    enumValues
      .map(
        (value) =>
          `map == '${value}' ? ${dartEnumName}.${convertString(value)} : `
      )
      .join("") + `${dartEnumName}.unKnown`
  };}`;

  return (
    enumContent +
    values +
    "\n" +
    "unKnown;" +
    "\n" +
    toMap +
    "\n" +
    fromMap +
    "\n}"
  );
}

function convertString(input: string): string {
  // Check if the string is already in camelCase
  if (/^[a-z]+([A-Z][a-z]*)*$/.test(input)) {
    return input; // Return as is if it's camelCase
  }

  // Split the string by underscores
  const parts = input.split("_");

  // Transform each part: lower case for the first part, capitalize others
  const transformedParts = parts.map((part, index) => {
    return index === 0
      ? part.toLowerCase()
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });

  // Join the parts back together
  return transformedParts.join("");
}

function mapJsonSchemaTypeToDart(
  folderPath: string,
  propName: string,
  propDef: any,
  definitions: any
): string {
  const enumType = propDef.enum;
  if (enumType) {
    const enumFolder = path.join(folderPath, "models", "enums");
    if (!fs.existsSync(enumFolder)) {
      fs.mkdirSync(enumFolder);
    }
    fs.writeFileSync(
      path.join(enumFolder, `${toSnakeCase(propName)}.dart`),
      generateEnum(propName, enumType)
    );

    return propDef.type === "array"
      ? "List<" +
          `${
            toCamelCase(propName).charAt(0).toUpperCase() +
            toCamelCase(propName).slice(1)
          }` +
          ">"
      : `${
          toCamelCase(propName).charAt(0).toUpperCase() +
          toCamelCase(propName).slice(1)
        }`;
  }
  const types = Array.isArray(propDef.type) ? propDef.type : [propDef.type];
  const typeMapping: { [key: string]: string } = {
    integer: "int",
    string: "String",
    boolean: "bool",
    object: "Map<String, dynamic>",
  };

  let dartType = "dynamic"; // Default type

  for (const type of types) {
    if (typeMapping[type]) {
      dartType = typeMapping[type];
    } else if (type === "array" && propDef.items) {
      // Handle array types
      if (propDef.items.$ref) {
        const referencedType = propDef.items.$ref.split("/").pop(); // Get the class name from $ref
        const UpperCamelReferencedType =
          toCamelCase(referencedType).charAt(0).toUpperCase() +
          toCamelCase(referencedType).slice(1); // Get the class name from $ref
        dartType = `List<${
          toCamelCase(referencedType).charAt(0).toUpperCase() +
          toCamelCase(referencedType).slice(1)
        }>`; // Convert to Dart list of class type
      }
    }
  }

  /*   // Check if the types include "null"
  if (types.includes("null")) {
    return `${dartType}?`; // Mark as nullable in Dart
  } */

  if (dartType === "dynamic") {
    return propDef.$ref
      ? toCamelCase(propDef.$ref.split("/").pop()).charAt(0).toUpperCase() +
          toCamelCase(propDef.$ref.split("/").pop()).slice(1)
      : "dynamic";
  }

  return dartType;
}

export function deactivate() {}
