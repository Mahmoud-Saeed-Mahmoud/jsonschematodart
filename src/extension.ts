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

        generateModels(schema, modelsFolder);
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

function generateModels(schema: any, outputDir: string) {
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
  className: string,
  definition: any,
  definitions: any
): string {
  const dartClassName = toCamelCase(className);
  const properties = definition.properties || {};

  let classContent = `class ${dartClassName} {\n`;

  for (const [propName, propDef] of Object.entries(properties)) {
    const fieldName = toLowerCamelCase(propName);
    const fieldType = mapJsonSchemaTypeToDart(propName, propDef, definitions);
    classContent += `  final ${fieldType} ${fieldName};\n`;
  }

  classContent += "\n  // Add constructor, fromJson, toJson methods here\n";
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
    .map((value) => `  ${toCamelCase(value)},`)
    .join("\n");

  return `${enumContent}${values}\n}\n\n`;
}

function mapJsonSchemaTypeToDart(
  propName: string,
  propDef: any,
  definitions: any
): string {
  const enumType = propDef.enum;
  if (enumType) {
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
        dartType = `List<${toCamelCase(referencedType)}>`; // Convert to Dart list of class type
      }
    }
  }

  // Check if the types include "null"
  if (types.includes("null")) {
    return `${dartType}?`; // Mark as nullable in Dart
  }

  if (dartType === "dynamic") {
    return propDef.$ref
      ? toCamelCase(propDef.$ref.split("/").pop())
      : "dynamic";
  }

  return dartType;
}

export function deactivate() {}
