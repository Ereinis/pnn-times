document.addEventListener("DOMContentLoaded", () => {

    const list = document.getElementById("issueList");
    const viewer = document.getElementById("pdfViewer");

    const placeholder = document.getElementById("placeholder");
    const readerBook = document.getElementById("readerBook");
    const currentIssueTitle = document.getElementById("currentIssueTitle");

    fetch("newspapers/index.json")
        .then(response => response.json())
        .then(data => {

            list.innerHTML = "";

            data.issues.forEach(issue => {

                const button = document.createElement("button");
                button.className = "issue-card";
                button.textContent = issue.title;

                button.onclick = () => {

                    placeholder.hidden = true;
                    readerBook.hidden = false;

                    currentIssueTitle.textContent = issue.title;

                    viewer.src = issue.url + "#toolbar=0&navpanes=0";

                };

                list.appendChild(button);

            });

        })
        .catch(error => console.error(error));

});
