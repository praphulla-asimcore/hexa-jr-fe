const XLSX = require('xlsx');

const REQUIRED_COLS = [
  'Employee ID',
  'Nickname / Name',
  'Cost Centre',
  'Gross Salary',
  'EPF Employer',
  'EIS Employer',
  'SOCSO Employer',
  'HRDF',
  'MTD',
  'CTC Hexa',
  'Net Salary',
];

function toNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  const n = parseFloat(val.toString().replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const entities = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

    if (!rows || rows.length < 2) continue;

    const headerRow = rows[0];
    const colMap = {};
    headerRow.forEach((cell, idx) => {
      if (cell !== null && cell !== undefined) {
        colMap[cell.toString().trim()] = idx;
      }
    });

    const missingCols = REQUIRED_COLS.filter((c) => !(c in colMap));

    const employees = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const employeeId = row[colMap['Employee ID']];
      if (employeeId === null || employeeId === undefined || employeeId.toString().trim() === '') continue;

      const ctcHexa = toNum(row[colMap['CTC Hexa']]);
      if (ctcHexa === 0) continue;

      employees.push({
        employeeId: employeeId.toString().trim(),
        name: (row[colMap['Nickname / Name']] || '').toString().trim(),
        costCentre: (row[colMap['Cost Centre']] || '').toString().trim(),
        grossSalary: toNum(row[colMap['Gross Salary']]),
        epfEmployer: toNum(row[colMap['EPF Employer']]),
        eisEmployer: toNum(row[colMap['EIS Employer']]),
        socsoEmployer: toNum(row[colMap['SOCSO Employer']]),
        hrdf: toNum(row[colMap['HRDF']]),
        mtd: toNum(row[colMap['MTD']]),
        ctcHexa,
        netSalary: toNum(row[colMap['Net Salary']]),
      });
    }

    if (employees.length === 0) continue;

    const totalCTC = employees.reduce((sum, e) => sum + e.ctcHexa, 0);

    entities.push({
      sheetName,
      employees,
      totalCTC: Math.round(totalCTC * 100) / 100,
      missingColumns: missingCols,
    });
  }

  return entities;
}

module.exports = { parseExcel };
