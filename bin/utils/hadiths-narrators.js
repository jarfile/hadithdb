/* jslint node:true, esversion:6 */

"use strict";
const fs = require('fs');
const LineReaderSync = require('line-reader-sync');
const { format } = require('@fast-csv/format');

var lineReader = new LineReaderSync('data/archive/hadiths-final.csv');
for (var line = lineReader.readline(); line != null; line = lineReader.readline()) {
    try {
        var toks = line.split(/\t/);
        if (!toks) return;
        var cid = toks[0];
        var n = toks[1];
        var g = toks[2];
        var h_en = toks[3];
        var h_ar = toks[4];
        var ch = '';
        var m = '';
        if (h_en.startsWith("\""))
            h_en = h_en.replace(/^"/, "").replace(/"$/, "");
        h_en = h_en.replace(/\"{2,}/g, "\"");

        // normalize
        h_ar = h_ar.replace(/[\:\"\'،۔ـ\-\.\,]/g, '');
        h_ar = h_ar.replaceAll('رضى الله عنها', '');
        h_ar = h_ar.replaceAll('رضى الله عنهما', '');
        h_ar = h_ar.replaceAll('رضى الله عنهم', '');
        h_ar = h_ar.replaceAll('رضى الله عنه', '');
        h_ar = h_ar.replaceAll('صلى الله عليه وسلم', 'ﷺ');
        h_ar = h_ar.replace(/\s+/g, ' ').trim();
        var h2 = h_ar + '';
        var m2 = '';
        h2 = h2.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
        h2 = h2.replace(/و?(حدثنا|حدثني|حدثناه|حدثه) /g, '~ ');
        h2 = h2.replace(/و?(أخبرنا|أخبرناه|أخبرني|أخبره) /g, '~ ');
        h2 = h2.replace(/و?(سمعت|سمعنا|سمعناه|سمع) /g, '~ ');
        h2 = h2.replace(/(عن|عنه|عنها) /g, '~ ');
        h2 = h2.replace(/(يبلغ به) /g, '~~ ');
        h2 = h2.replace(/(أنه|أن|أنها) /g, '~ ');
        h2 = h2.replace(/(قال|قالت) /g, '~ ');
        h2 = h2.replace(/\s+/g, ' ').trim();
        // extract body
        var narr_toks = h2.split(/~/);
        if (narr_toks) {
            var h2_tokslen = [];
            narr_toks.forEach(tok => {
                h2_tokslen.push(wordCount(tok));
            });
            for (var i = 0; i < narr_toks.length; i++) {
                if (narr_toks[i].match(/(نبي|رسول)/)) {
                    m2 = narr_toks.slice(i).join('~ ');
                    break;
                } else if (h2_tokslen[i] > 7 && !narr_toks[i].match(/ (بن|ابن) /)) {
                    m2 = narr_toks.slice(i).join('~ ');
                    break;
                }
            }
            if (m2 == '')
                m2 = narr_toks[narr_toks.length - 1];
        }
        if (m2 == null) {
            process.stdout.write('ERROR on: ' + cid + ' ' + n + '\n');
            return;
        }
        m2 = m2.replace(/\s+/g, ' ').trim();

        // extract chain and body
        var h_toks = h_ar.split(/ /);
        var h2_toks = h2.split(/ /);
        var m2_toks = m2.split(/ /);
        var m = '';
        if (!h_toks || !m2_toks || h_toks.length == m2_toks.length)
            m = h_ar;
        else {
            var diff = h_toks.length - m2_toks.length;
            for (i = (diff - 1); i >= 0; i--) {
                if (h2_toks[i].endsWith('~'))
                    diff--;
                else
                    break;
            }
            ch = h_toks.slice(0, diff).join(' ').trim();
            m = h_toks.slice(diff).join(' ').trim();
        }

        // write
        process.stdout.write(cid + '\t' + n + '\t' + g + '\t' + h_en + '\t' + h_ar + '\t' + ch + '\t' + m + '\n');
    } catch (err) {
        console.log(err);
        break;
    }
};

function wordCount(s) {
    return s.split(' ').length;
}
