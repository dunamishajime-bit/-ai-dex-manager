import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const WATCHDOG_PATH = resolve(process.cwd(), "scripts/disdex-runner-watchdog.ts");
const EXCHANGE_MODULE = /(?:exchange|aster|binance|hyperliquid|direct[-_]trade|ccxt)/i;
const FORBIDDEN_OPERATION = /^(?:submit|submitOrder|place|placeOrder|placeMarket|placeLimit|cancel|cancelOrder|close|closeOrder|closePosition|closeAll|execute|executeOrder|executeMarket|sendOrder|modifyOrder|modifyPosition)$/i;
const SYSTEMCTL_OPERATIONS = new Set(["is-active", "show", "restart"]);

export type WatchdogBoundaryInspection = { violations: string[] };

function textOf(node: ts.Node, sourceFile: ts.SourceFile): string {
    return node.getText(sourceFile);
}

function literalText(node: ts.Expression | undefined): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
}

function propertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression, sourceFile: ts.SourceFile): string | undefined {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return literalText(node.argumentExpression) ?? textOf(node.argumentExpression, sourceFile);
}

function enclosingMethod(node: ts.Node): ts.MethodDeclaration | undefined {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (ts.isMethodDeclaration(current)) return current;
    }
    return undefined;
}

export function inspectWatchdogSource(source: string): WatchdogBoundaryInspection {
    const sourceFile = ts.createSourceFile("disdex-runner-watchdog.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];
    const add = (message: string, node: ts.Node) => violations.push(`${message} at ${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`);

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node)) {
            const moduleName = literalText(node.moduleSpecifier);
            if (moduleName && EXCHANGE_MODULE.test(moduleName)) add("exchange client import", node);
        }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const moduleName = literalText(node.moduleReference.expression);
            if (moduleName && EXCHANGE_MODULE.test(moduleName)) add("exchange client import", node);
        }
        if (ts.isCallExpression(node)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add("exchange client import via dynamic import", node);
            if (ts.isIdentifier(node.expression) && node.expression.text === "require") add("exchange client import via require", node);

            if (ts.isIdentifier(node.expression) && node.expression.text === "execFile") {
                const [command, args] = node.arguments;
                if (!command || !ts.isIdentifier(command) || command.text !== "SYSTEMCTL") {
                    add("systemctl command is not routed through the strict policy", node);
                } else if (!args || !ts.isArrayLiteralExpression(args)) {
                    add("systemctl arguments are not a static allowlisted array", node);
                } else {
                    const operation = literalText(args.elements[0]);
                    const unit = args.elements[1];
                    const method = enclosingMethod(node);
                    if (!operation || !SYSTEMCTL_OPERATIONS.has(operation)) add("systemctl operation is not allowlisted", node);
                    if (!unit || !ts.isIdentifier(unit) || unit.text !== "unit") add("systemctl unit is not the guarded unit parameter", node);
                    if (!method || !method.body || !method.body.getText(sourceFile).includes("assertSystemctlUnit(unit)")) {
                        add("systemctl call bypasses assertSystemctlUnit", node);
                    }
                }
            }
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const name = propertyName(node, sourceFile);
            const receiver = node.expression;
            if (name && FORBIDDEN_OPERATION.test(name) && !(name === "close" && ts.isIdentifier(receiver) && receiver.text === "handle")) {
                add("forbidden order/lifecycle operation", node);
            }
        }
        if (ts.isIdentifier(node) && FORBIDDEN_OPERATION.test(node.text) && node.parent && ts.isCallExpression(node.parent)) {
            add("forbidden order/lifecycle operation", node);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return { violations };
}

export function assertWatchdogSafetyBoundary(sourcePath = WATCHDOG_PATH): void {
    const inspection = inspectWatchdogSource(readFileSync(sourcePath, "utf8"));
    if (inspection.violations.length > 0) {
        throw new Error(`watchdog safety boundary failed:\n${inspection.violations.join("\n")}`);
    }
}

if (process.argv[1]?.endsWith("disdex-runner-watchdog-safety-boundary.ts")) {
    assertWatchdogSafetyBoundary();
    console.log("Runner watchdog static safety boundary: PASS");
}
