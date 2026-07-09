// client/scripts/android-runtime/parseCoverageTable.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseCoverageTable(markdownPath) {
  const content = fs.readFileSync(markdownPath, 'utf8');
  const lines = content.split('\n');

  const rawCoverageExpressions = [];
  const expandedCoverageIds = [];
  const parseErrors = [];
  const parseWarnings = [];

  let tableStarted = false;
  let headers = [];
  let rowIndex = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (line.startsWith('|')) {
      const cols = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (!tableStarted) {
        if (cols.some(c => /Scenario ID/i.test(c))) {
          headers = cols;
          tableStarted = true;
          rowIndex = 0;
        }
        continue;
      }
      if (line.includes('---')) {
        continue;
      }

      // We have a table row
      rowIndex++;
      const idCol = cols[0];
      if (!idCol) continue;

      const rawRowHash = crypto.createHash('sha256').update(line).digest('hex');

      // Check if it is a range expression
      if (idCol.includes('-') || idCol.includes('\u2013')) {
        rawCoverageExpressions.push(idCol);
        
        // Parse range: e.g. A01–A11
        const parts = idCol.split(/\u2013|-/).map(p => p.trim());
        if (parts.length !== 2) {
          parseErrors.push({
            errorCode: 'MALFORMED_RANGE_EXPRESSION',
            documentFilename: path.basename(markdownPath),
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawExpression: idCol,
            normalizedExpression: idCol,
            message: `Range expression must have exactly one separator: ${idCol}`
          });
          continue;
        }

        const [start, end] = parts;
        const startMatch = start.match(/^([A-Za-z_]+)(\d+)$/);
        const endMatch = end.match(/^([A-Za-z_]+)(\d+)$/);

        if (!startMatch || !endMatch) {
          parseErrors.push({
            errorCode: 'MALFORMED_RANGE_EXPRESSION',
            documentFilename: path.basename(markdownPath),
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawExpression: idCol,
            normalizedExpression: idCol,
            message: `Range bounds must consist of prefix and digits: ${idCol}`
          });
          continue;
        }

        const [, startPrefix, startNumStr] = startMatch;
        const [, endPrefix, endNumStr] = endMatch;

        if (startPrefix !== endPrefix) {
          parseErrors.push({
            errorCode: 'MIXED_PREFIX',
            documentFilename: path.basename(markdownPath),
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawExpression: idCol,
            normalizedExpression: idCol,
            message: `Mixed prefixes not permitted: ${startPrefix} vs ${endPrefix}`
          });
          continue;
        }

        if (startNumStr.length !== endNumStr.length) {
          parseErrors.push({
            errorCode: 'MIXED_PADDING',
            documentFilename: path.basename(markdownPath),
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawExpression: idCol,
            normalizedExpression: idCol,
            message: `Mixed padding widths not permitted: ${startNumStr} vs ${endNumStr}`
          });
          continue;
        }

        const startNum = parseInt(startNumStr, 10);
        const endNum = parseInt(endNumStr, 10);

        if (endNum < startNum) {
          parseErrors.push({
            errorCode: 'DESCENDING_RANGE',
            documentFilename: path.basename(markdownPath),
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawExpression: idCol,
            normalizedExpression: idCol,
            message: `Range ${idCol} cannot descend`
          });
          continue;
        }

        // Expand
        const width = startNumStr.length;
        for (let num = startNum; num <= endNum; num++) {
          const paddedNum = String(num).padStart(width, '0');
          const expandedId = `${startPrefix}${paddedNum}`;

          expandedCoverageIds.push({
            id: expandedId,
            provenanceClass: 'UNDEFINED_PLACEHOLDER_SOURCE',
            sourceSection: 'Coverage Table',
            tableRowIndex: rowIndex,
            rawRowHash,
            rawExpression: idCol,
            expansionSourceExpression: idCol
          });
        }
      } else {
        // Single ID
        const isACC = idCol === 'ACC-1' || idCol === 'ACC-2';
        expandedCoverageIds.push({
          id: idCol,
          provenanceClass: isACC ? 'DEFINING_SOURCE' : 'COVERAGE_SOURCE',
          sourceSection: 'Coverage Table',
          tableRowIndex: rowIndex,
          rawRowHash,
          rawExpression: null,
          expansionSourceExpression: null
        });
      }
    }
  }

  const documentHash = crypto.createHash('sha256').update(content).digest('hex');

  return {
    documentFilename: path.basename(markdownPath),
    documentHash,
    parserName: 'parseCoverageTable',
    parserVersion: '1.2.0',
    parsedIds: expandedCoverageIds,
    rawCoverageExpressions,
    expandedCoverageIds,
    parseWarnings,
    parseErrors
  };
}

module.exports = { parseCoverageTable };
