# PRISQ – Prediabetes Risk Assessment PWA

PRISQ is a Progressive Web Application (PWA) that evaluates prediabetes risk 
using either a quantized scoring model or a logistic regression model.
The app supports multilingual UI (English & Arabic) and dynamic question flow.

## Overview

PRISQ is a browser-based health risk assessment tool that:

- Collects user health inputs
- Calculates risk using configurable scoring models
- Supports English and Arabic
- Works offline as a Progressive Web App
- Provides dynamic branching question flow

## Architecture

The application follows a modular structure:

- site.js → Website controller (language, UI updates, layout direction)
- quiz.js → Quiz engine (rendering, state, scoring logic)
- quiz_data.json → Question data & scoring configuration
- manifest.json → PWA configuration
- service-worker.js → Offline support

## Scoring Models

The system supports two scoring approaches:

1. Quantized Model
   - Point-based scoring
   - Each answer contributes a scoreValue
   - Total score maps to risk category

2. Beta Model (Logistic Regression)
   - Uses intercept and beta coefficients
   - Calculates probability using logistic function
   - Returns percentage risk

   Change PRIMARY_MODEL in quiz.js to: "quantized" or "beta"

## Language Support

- English (LTR)
- Arabic (RTL)

Language is stored in localStorage.
site.js manages UI updates and layout direction.

## Adding Questions

Questions are defined in quiz_data.json.

Each question requires:
- Unique id
- question text (EN & AR)
- inputType
- next question reference

## PWA Features

- Installable on mobile
- Offline functionality
- Cached assets via service worker
- Responsive layout

---------------------------------------------------------------------------------------------------------------------------------

# Instructions on how to run the project and upload it in server:

This explains how to deploy the PRISQ Progressive Web App (PWA) to the nginx server.

Server Domain:
https://prisq2.qcri.org

Server Root Directory:
/var/www/html

---

## 1️ Connect to Server (SSH)

```bash
ssh username@qcri.org@10.4.4.138

3️. To Remove Existing Files (Clean Deployment)

Navigate to web root:

cd /var/www/html

Remove all existing files:

sudo rm -rf *

Confirm directory is empty:

ls

4️. Upload Project Files from Windows

Open PowerShell.

Navigate to project folder (example):

cd "C:\Users\User\Desktop\PRISQ2"

Upload files to server home directory:

scp -r ./* username@qcri.org@10.4.4.138:~

5️. Move Files to nginx Root

SSH into server:

ssh username@qcri.org@10.4.4.138

Move files:

sudo mv * /var/www/html/

6️. Fix Permissions (IMPORTANT)
cd /var/www/html
sudo chown -R www-data:www-data .
sudo chmod -R 755 .

7️. Reload nginx
sudo systemctl reload nginx

8️. Clear Old Service Worker Cache (Browser)

If old content appears:

Open DevTools
Go to Application → Service Workers
Click "Unregister"
Go to Storage → Clear site data
Hard refresh (Ctrl + Shift + R)

9️. Verify Deployment

Open:

https://prisq2.qcri.org

Check:

Manifest loads
Service Worker registered
Install button appears
No console errors

10️. Useful Commands

Check nginx status:

sudo systemctl status nginx

Restart nginx:

sudo systemctl restart nginx

List files in web root:

ls -R /var/www/html

Check service worker in browser console:

navigator.serviceWorker.getRegistrations()




