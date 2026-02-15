# MTN Muhasebe ERP (Kurumsal Çoklu Pencere)

Bu sürüm, gerçek operasyon kullanımına odaklı olarak yeniden kurgulandı:
- **Multi-window Electron**: Her modül ayrı pencere.
- **SQLite WAL + migration**: JSON omurga kaldırıldı.
- **Double-entry muhasebe motoru**: Journal voucher + line zorunlu, dengesiz kayıt reddi.
- **RBAC + hash parola**: Varsayılan şifre yok, ilk açılışta admin kurulumu.
- **Append-only audit log** ve şifreli backup/restore.

## Modül Pencereleri
Ana menüden açılan pencereler:
- Cari, Stok, Satış, Alış, Kasa, Banka, Teklif, Fatura, Raporlar, Ayarlar, Kullanıcılar, Yedekleme

## Çalıştırma
```bash
npm install
npm start
```

## Node sürümü (Önemli)
- Önerilen: **Node 20/22 LTS**
- Destek aralığı: `>=20 <25`

> Windows'ta `better-sqlite3` derleme hatası alırsanız (özellikle Node 24 + Visual Studio yoksa):
> 1) Node 22 LTS'e geçin (`nvm use 22`)
> 2) `node_modules` ve `package-lock.json` silip tekrar `npm install` çalıştırın
> 3) Gerekirse Visual Studio Build Tools + "Desktop development with C++" kurun.

## Test
```bash
npm test
```
(15+ muhasebe motoru senaryosu)

## Dizin Yapısı
- `src/main`: Electron main, window manager, db, ipc, services
- `src/renderer`: modül pencereleri
- `src/shared`: constants + validation
- `migrations`: SQL migration dosyaları
- `tests`: muhasebe motoru testleri
