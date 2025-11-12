// document.addEventListener("DOMContentLoaded", function () {
//     console.log("Desk loaded (v15), applying sidebar toggle...");

//     // Helper: hide sidebar(s)
//     function hideSidebar() {
//         const side = document.querySelector(".workspace-sidebar, .desk-sidebar, .layout-side-section");
//         const main = document.querySelector(".layout-main-section");

//         if (side && main) {
//             side.style.display = "none";
//             main.style.width = "100%";
//             console.log("Sidebar hidden ✔️");
//             return true;
//         }
//         return false;
//     }

//     // Try hiding immediately
//     if (!hideSidebar()) {
//         // Observe DOM mutations in case sidebar is injected later
//         const observer = new MutationObserver(() => {
//             if (hideSidebar()) observer.disconnect();
//         });
//         observer.observe(document.body, { childList: true, subtree: true });
//     }

//     // Add toggle button if missing
//     if (!document.querySelector(".sidebar-toggle-btn")) {
//         const btn = document.createElement("button");
//         btn.className = "btn btn-default sidebar-toggle-btn";
//         btn.innerText = "☰ Sidebar";
//         const nav = document.querySelector(".navbar .container");
//         if (nav) nav.appendChild(btn);
//     }

//     // Toggle handler
//     document.body.addEventListener("click", function (e) {
//         if (e.target.closest(".sidebar-toggle-btn")) {
//             const side = document.querySelector(".workspace-sidebar, .desk-sidebar, .layout-side-section");
//             const main = document.querySelector(".layout-main-section");

//             if (!side || !main) return;

//             if (getComputedStyle(side).display === "none") {
//                 side.style.display = "";   // let default CSS handle
//                 main.style.width = "";
//                 console.log("Sidebar shown ✔️");
//             } else {
//                 side.style.display = "none";
//                 main.style.width = "100%";
//                 console.log("Sidebar hidden ✔️");
//             }
//         }
//     });
// });




document.body.addEventListener("click", function (e) {
    handleToggle(e);
});

document.body.addEventListener("touchstart", function (e) {
    handleToggle(e);
});

function handleToggle(e) {
    if (e.target.closest(".sidebar-toggle-btn")) {
        const side = document.querySelector(".workspace-sidebar, .desk-sidebar, .layout-side-section");
        const main = document.querySelector(".layout-main-section");

        if (!side || !main) return;

        if (getComputedStyle(side).display === "none") {
            side.style.display = "";
            main.style.width = "";
            console.log("Sidebar shown ✔️");
        } else {
            side.style.display = "none";
            main.style.width = "100%";
            console.log("Sidebar hidden ✔️");
        }
    }
}