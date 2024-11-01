import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "extension.convertJsonSchema",
    async () => {
      const jsonSchema = await vscode.env.clipboard.readText();
      // Call your conversion function here
      const dartModel = convertJsonSchemaToDart(jsonSchema);
      // Display the result or write to a new file
    }
  );

  context.subscriptions.push(disposable);
}

function convertJsonSchemaToDart(schema: string): string {
  // Implement your conversion logic here
  return ""; // Replace with actual Dart model as a string
}

export function deactivate() {}
